#!/usr/bin/node

// crypto is expected to be installed globally

const crypto = require(`crypto`);
const http = require(`http`);
const { execSync } = require(`child_process`);

const pm2config = require(`./ecosystem.config.js`);
const secrets = require(`./ofl-secrets.json`);

const pm2AppConfig = pm2config.apps.find(app => app.name === `ofl`);

const deploymentConfig = {
  env: pm2AppConfig.env,
  action: ``,
  webhookPort: 40010,
  webhookPath: `/`,
  webhookSecret: secrets.OFL_WEBHOOK_SECRET
};


startServer()
  .then(() => console.log(`Exited`))
  .catch(error => console.error(`Exited with error`, error));


/**
 * @returns {Promise} Promise that resolves/rejects when the server process terminates.
 */
function startServer() {
  const port = deploymentConfig.webhookPort;

  console.log(`Starting webhook listener on port ${port}`);

  return new Promise((resolve, reject) => {
    http.createServer((request, response) => {
      response.writeHead(200, { 'Content-Type': `text/plain` });
      response.write(`Received`);
      response.end();

      if (request.method !== `POST`) {
        return;
      }

      let body = ``;
      request.on(`data`, data => {
        body += data;
      }).on(`end`, () => {
        processRequest(request.url, body, request.headers);
      });

    }).on(`close`, resolve).on(`error`, reject).listen(port);
  });
}

/**
 * Handle a received request from the server and check if it is valid. If so,
 * call @see redeploy to update the corresponding app.
 *
 * @param {String} url The absolute path the request was received at.
 * @param {String} body The JSON string from GitHub.
 * @param {Object.<String, String>} headers Headers of the request.
 */
function processRequest(url, body, headers) { // eslint-disable-line complexity
  console.log(`Received webhook request at ${url}`);

  if (deploymentConfig.webhookPath !== url) {
    return;
  }

  const hmac = crypto.createHmac(`sha1`, deploymentConfig.webhookSecret);
  hmac.update(body, `utf-8`);

  const xub = `X-Hub-Signature`;
  const received = headers[xub] || headers[xub.toLowerCase()];
  const expected = `sha1=${hmac.digest(`hex`)}`;

  if (received !== expected) {
    console.error(`Wrong secret: Expected '${expected}', received '${received}'`);
    return;
  }

  console.info(`Secret test passed`);

  const eventName = headers[`X-GitHub-Event`] || headers[`x-github-event`];
  if (eventName !== `status`) {
    console.log(`Wrong event name: Expected 'status', received '${eventName}'`);
    return;
  }

  const json = JSON.parse(body);

  const affectsMasterBranch = `branches` in json && json.branches.some(branch => branch.name === `master`);
  if (json.state !== `success` || !affectsMasterBranch) {
    console.log(`Only handle successful events on master branch`);
    return;
  }

  redeploy(json);
}

/**
 * Calls redeploy bash script and notify admin via email if script fails.
 * @param {Object} webhookPayload The data delivered by GitHub via the webhook.
 */
function redeploy(webhookPayload) {
  console.log(`Redeploy...`);

  try {
    execSync(`./redeploy.sh`, {
      cwd: `/home/flo`,
      env: Object.assign({}, process.env, deploymentConfig.env),
      encoding: `utf8`,
      stdio: `pipe`
    });
    console.log(`Successfully deployed.`);
  }
  catch (error) {
    console.log(`Redeploy process failed with exit code ${error.status}.`);
    console.log(`Notify admin via email about failed deployment...`);

    const subject = `OFL Deployment failed`;
    let body = (new Date()).toISOString();
    body += `\n\nsubprocess status: ${error.status}, signal: ${error.signal}`;
    body += `\n\nsubprocess stdout:\n${error.stdout}`;
    body += `\n\nsubprocess stderr:\n${error.stderr}`;
    body += `\n\nwebhook payload: ${JSON.stringify(webhookPayload, null, 2)}`;

    execSync(`mail -s "${subject}" root`, {
      input: body
    });
  }
}
