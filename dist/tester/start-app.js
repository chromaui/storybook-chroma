import { spawn } from 'child_process';
import fetch from 'isomorphic-fetch';
import path from 'path';

const CHECK_EVERY = 1000;
const TIMEOUT = 5 * 60 * 1000;

export async function checkResponse(url) {
  try {
    await fetch(url);
    return true;
  } catch (e) {
    return false;
  }
}

async function waitForResponse(child, url) {
  const timeoutAt = Date.now() + TIMEOUT;
  return new Promise((resolve, reject) => {
    let resolved = false;
    async function check() {
      if (Date.now() > timeoutAt) {
        resolved = true;
        reject(new Error(`No server responding at ${url} within ${TIMEOUT / 1000} seconds.`));
        return;
      }

      if (await checkResponse(url)) {
        resolved = true;
        resolve();
        return;
      }
      setTimeout(check, CHECK_EVERY);
    }
    check();

    if (child) {
      let output = '';
      child.stderr.on('data', e => {
        output += e.toString();
      });
      child.stdout.on('data', o => {
        output += o.toString();
      });

      child.on('close', () => {
        if (!resolved) {
          reject(new Error(`Script failed to start: ${output}\n`));
        }
      });
    }
  });
}

export default async function startApp({
  scriptName,
  commandName,
  args = [],
  url,
  inheritStdio = false,
}) {
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    BROWSER: 'none',
  };

  let child;
  if (scriptName) {
    if (await checkResponse(url)) {
      // We assume the process that is already running on the url is indeed our storybook
      return null;
    }

    // This technique lifted from https://github.com/mysticatea/npm-run-all/blob/52eaf86242ba408dedd015f53ca7ca368f25a026/lib/run-task.js#L156-L174
    const npmPath = process.env.npm_execpath;
    const npmPathIsJs = typeof npmPath === 'string' && /\.m?js/.test(path.extname(npmPath));
    const execPath = npmPathIsJs ? process.execPath : npmPath || 'npm';

    // Run either:
    //   npm/yarn run scriptName (depending on npm_execpath)
    //   node path/to/npm.js run scriptName (if npm run via node)
    child = spawn(execPath, [...(npmPathIsJs ? [npmPath] : []), 'run', scriptName, ...args], {
      env,
      ...(inheritStdio && { stdio: 'inherit' }),
    });
  } else {
    if (!commandName) {
      throw new Error('You must pass commandName or scriptName');
    }
    child = spawn(commandName, { env, shell: true });
  }

  if (url) {
    await waitForResponse(child, url);
  }

  return child;
}
