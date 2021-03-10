const { exec } = require('child_process');
const puppeteer = require('puppeteer');
const express = require('express');
const WebSocket = require('ws');
let { GIT_OWNER, GIT_REPOS } = require('./config');

const app = express();
const PORTS = { APP: 3000, WS: 8080 };
const wss = new WebSocket.Server({ port: PORTS.WS });

const STATUS = { IN_PROGRESS: 'in-progress', COMPLETED: 'completed', ERROR: 'error' };
const PHASE = { GENERATE: 'Generate', CLEAN: 'Tmp Cleaning', CLONE: 'Git Cloning', INSTALL: 'NPM Installing', TEST: 'Ember Testing', REPORT: 'Rendering Report' };

let repos = GIT_REPOS.map(repo => {
    return {
        name: repo,
        branch: 'master',
        isReportGenerating: false,
        isReportGenerated: false,
        phase: PHASE.GENERATE,
        message: ''
    };
});;

function getUpdatedReposInfo(selectedRepo, status, phase, message = '') {
    repos = repos.map(repo => {
        if (repo.name === selectedRepo.name) {
            repo.phase = phase;
            repo.message = message;
            repo.branch = selectedRepo.branch;
            if (status === STATUS.IN_PROGRESS) {
                repo.isReportGenerating = true;
                repo.isReportGenerated = false;
            } else if (status === STATUS.COMPLETED) {
                repo.isReportGenerating = false;
                repo.isReportGenerated = true;
            } else if (status === STATUS.ERROR) {
                repo.isReportGenerating = false;
                repo.isReportGenerated = false;
            }
        }
        return repo;
    });

    return JSON.stringify(repos);
}

async function renderPDF(repoName) {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORTS.APP}/tmp/${repoName}/coverage`, { waitUntil: 'networkidle2' });
    await page.pdf({ path: `tmp/${repoName}/coverage/${repoName}-coverage-report.pdf`, printBackground: true });

    await browser.close();
    return;
}

async function execCommand(cmd) {
    return new Promise((resolve, reject) => {
        let execProcess = exec(cmd),
            errorMessage = '';
        execProcess.stdout.setEncoding('utf8');
        execProcess.stderr.setEncoding('utf8');
        execProcess.stdout.on('data', data => (errorMessage = data) && console.log(data));
        execProcess.stderr.on('data', data => (errorMessage = data) && console.log(data));
        execProcess.on('exit', code => code == 0 ? resolve(code) : reject(errorMessage));
    });
}

async function generateReport(ws, repo) {
    const { name, branch } = repo;
    try {
        ws.send(getUpdatedReposInfo(repo, STATUS.IN_PROGRESS, PHASE.CLEAN));
        await execCommand(`mkdir -p tmp && cd tmp && rm -rf ${name}`);

        ws.send(getUpdatedReposInfo(repo, STATUS.IN_PROGRESS, PHASE.CLONE));
        await execCommand(`cd tmp && git clone -b ${branch} https://github.com/${GIT_OWNER}/${name}.git`);

        ws.send(getUpdatedReposInfo(repo, STATUS.IN_PROGRESS, PHASE.INSTALL));
        await execCommand(`cd tmp && cd ${name} && npm run localinstall`);

        ws.send(getUpdatedReposInfo(repo, STATUS.IN_PROGRESS, PHASE.TEST));
        await execCommand(`cd tmp && cd ${name} && npm run coverage`);

        ws.send(getUpdatedReposInfo(repo, STATUS.IN_PROGRESS, PHASE.REPORT));
        await renderPDF(name);

        ws.send(getUpdatedReposInfo(repo, STATUS.COMPLETED, PHASE.GENERATE));
    } catch (error) {
        console.log('generateReport::err:::', error);
        ws.send(getUpdatedReposInfo(repo, STATUS.ERROR, PHASE.GENERATE, error));
    }
}

wss.on('connection', function connection(ws) {
    console.log("App connected with socket...");

    ws.on('message', function incoming(message) {
        console.log('received: %s', message);
        generateReport(ws, JSON.parse(message));
    });

    ws.send(JSON.stringify(repos));
});

app.use('/', express.static('src/public'));
app.use('/coverage', express.static('src/coverage'));

app.listen(PORTS.APP, () => console.log(`http://localhost:${PORTS.APP}`));
