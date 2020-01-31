#!/usr/bin/env node

const puppeteer = require('puppeteer');
const notifier = require('node-notifier');
const chalk = require('chalk');
const winston = require('winston');
const fs = require('fs');
const boxen = require('boxen');
const gradient = require('gradient-string');
const logSymbols = require('log-symbols');
const ansiEscapes = require('ansi-escapes');
const path = require('path');
const findChrome = require('./find_chrome');

const config = require('./config.js');
const selector = require('./selector.js');

process.setMaxListeners(0);

// make sure they specified user to chat with
if (!process.argv[2]) {
  console.log(logSymbols.error, chalk.red('User argument not specified, exiting...'));
  process.exit(1);
}

/////////////////////////////////////////////
// get user from command line argument
let user = '';

// because a username can contain first and last name/spaces, etc
for (let i = 2; i <= 5; i++) {
  if (typeof process.argv[i] !== 'undefined') {
    user += process.argv[i] + ' ';
  }
}

user = user.trim();
/////////////////////////////////////////////

// catch un-handled promise errors
process.on("unhandledRejection", (reason, p) => {
  //console.warn("Unhandled Rejection at: Promise", p, "reason:", reason);
});

(async function main() {

  const logger = setUpLogging();

  try {

    print(boxen('Whatspup', {
      padding: 1,
      borderStyle: 'double',
      borderColor: 'green',
      backgroundColor: 'green'
    }));

    // custom vars ///////////////////////////////
    let last_received_message = '';
    let last_received_message_other_user = '';
    let last_sent_message_interval = null;
    let sentMessages = [];
    //////////////////////////////////////////////

    const executablePath = findChrome().pop() || null;
    const tmpPath = path.resolve(__dirname, config.data_dir);
    const networkIdleTimeout = 30000;
    const stdin = process.stdin;
    const headless = !config.window;

    const browser = await puppeteer.launch({
      headless: headless,
      //executablePath: executablePath,
      userDataDir: tmpPath,
      ignoreHTTPSErrors: true,
      args: [
        '--log-level=3', // fatal only
        //'--start-maximized',
        '--no-default-browser-check',
        '--disable-infobars',
        '--disable-web-security',
        '--disable-site-isolation-trials',
        '--no-experiments',
        '--ignore-gpu-blacklist',
        '--ignore-certificate-errors',
        '--ignore-certificate-errors-spki-list',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-default-apps',
        '--enable-features=NetworkService',
        '--disable-setuid-sandbox',
        '--no-sandbox'
      ]
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3641.0 Safari/537.36');

    //await page.setViewport({width: 1366, height:768});
    await page.setRequestInterception(true);

    page.on('request', (request) => {
      request.continue();
    });

    print(gradient.rainbow('Initializing...\n'));

    page.goto('https://web.whatsapp.com/', {
      waitUntil: 'networkidle2',
      timeout: 0
    }).then(async function (response) {

      await page.waitFor(networkIdleTimeout);

      //debug(page);

      const title = await page.evaluate(() => {

        let nodes = document.querySelectorAll('.window-title');
        let el = nodes[nodes.length - 1];

        return el ? el.innerHTML : '';
      });

      // this means browser upgrade warning came up for some reasons
      if (title && title.includes('Google Chrome 36+')) {
        console.log(logSymbols.error, chalk.red('Could not open whatsapp web, most likely got browser upgrade message....'));
        process.exit();
      }
      await page.addScriptTag({ content: `${simulateMouseEvents}`});

      startChat(user);

      await readCommands();
    });

    // allow user to type on console and read it
    function readCommands() {
      stdin.resume();

      stdin.on('data', async function (data) {
        let message = data.toString().trim();
        if(message.toLowerCase().indexOf('--send_by_file') > -1){
          var numbers = fs.readFileSync('./numbers.txt').toString().split("\n");
          var message_template = fs.readFileSync('./message.txt').toString();
          for(k in numbers) {
            if (numbers[k].length === 0 ){
              continue;
            }
            console.log('pre click new chat');
            await clickNewChat();
            console.log('pre click new chat');
            await clickSearch();
            await clickSearch();
            await writeSearchString(numbers[k]);
            var is_select = await selectChat();
            await sleep(1000);
            if(is_select){
              await typeMessage(message_template);
            }
          }

        }
        stdin.resume();
      });
    }

    async function clickNewChat() {
      return await page.evaluate(function () {
        return simulateMouseEvents(document.querySelector("[title='Новый чат']"), 'mousedown');
      });
    }

    async function clickSearch(){
      return await page.evaluate(function () {
        const path = '#app > div > div > div._2aMzp > div._10V4p._3A_Ft > span > div > span > div > div:nth-child(2) > div > button';
        return simulateMouseEvents(document.querySelector(path), 'mousedown')
      });
    }

    async function writeSearchString(search){
      await page.evaluate(function (search) {
        let input = document.querySelector('[title="Поиск контактов"]');
        let lastValue = input.value;
        input.value = search;
        let event = new Event('input', { bubbles: true });
        event.simulated = true;
        let tracker = input._valueTracker;
        if (tracker) {
          tracker.setValue(lastValue);
        }
        input.dispatchEvent(event);
      }, search);
    }
    async function selectChat(){
      await sleep(1000);
      return await page.evaluate(function () {
        const path = '#app > div > div > div._2aMzp > div._10V4p._3A_Ft > span > div > span > div > div._1c8mz.rK2ei > div:nth-child(1) > div >' +
            ' div > div:nth-child(2) > div > div';
        var select = document.querySelector(path);
        if (typeof(select) != 'undefined' && select != null){
          select.click();
          return true;
        }
        // simulateMouseEvents(select, 'mousedown');
        // select.click();
        return false;
      });
    }
    async function openChaCha(){

      return await page.evaluate(function () {
        return document.querySelector('#main > header span[title="Chacha’s Crew"]').click()
      });
    }

    // start chat with specified user
    async function startChat(user) {
      // replace selector with selected user
      let user_chat_selector = selector.user_chat;
      user_chat_selector = user_chat_selector.replace('XXX', user);

      await page.waitFor(user_chat_selector);
      await page.click(user_chat_selector);
      await page.click(selector.chat_input);
      let name = getCurrentUserName();

      if (name) {
        console.log(logSymbols.success, chalk.bgGreen('You can chat now :-)'));
        console.log(logSymbols.info, chalk.bgRed('Press Ctrl+C twice to exit any time.\n'));
      } else {
        console.log(logSymbols.warning, 'Could not find specified user "' + user + '"in chat threads\n');
      }
    }

    // type user-supplied message into chat window for selected user
    async function typeMessage(message) {
      let parts = message.split('\n');

      for (var i = 0; i < parts.length; i++) {
        await page.keyboard.down('Shift');
        await page.keyboard.press('Enter');
        await page.keyboard.up('Shift');

        await page.keyboard.type(parts[i]);
      }

      await page.keyboard.press('Enter');

      // verify message is sent
      let messageSent = await page.evaluate((selector) => {

        let nodes = document.querySelectorAll(selector);
        let el = nodes[nodes.length - 1];

        return el ? el.innerText : '';
      }, selector.last_message_sent);
    }

    // read user's name from conversation thread
    async function getCurrentUserName() {
      return await page.evaluate((selector) => {
        let el = document.querySelector(selector);

        return el ? el.innerText : '';
      }, selector.user_name);
    }

    // prints on console
    function print(message, color = null) {

      if (!config.colors || color == null) {
        console.log('\n' + message + '\n');
        return;
      }

      if (chalk[color]) {
        console.log('\n' + chalk[color](message) + '\n');
      } else {
        console.log('\n' + message + '\n');
      }

    }

    // send notification
    function notify(name, message) {
      if (config.notification_enabled) {

        if (config.notification_hide_message) {
          message = config.notification_hidden_message || 'New Message Received';
        }

        if (config.notification_hide_user) {
          name = config.notification_hidden_user || 'Someone';
        }

        notifier.notify({
          appName: "Snore.DesktopToasts", // Windows FIX - might not be needed
          title: name,
          message: message,
          wait: false,
          timeout: config.notification_time
        });

        // sound/beep
        if (config.notification_sound) {
          process.stdout.write(ansiEscapes.beep);
        }

      }
    }

  } catch (err) {
    logger.warn(err);
  }

  async function debug(page, logContent = true) {
    if (logContent) {
      console.log(await page.content());
    }

    await page.screenshot({
      path: 'screen.png'
    });
  }

  // setup logging
  function setUpLogging() {

    const env = process.env.NODE_ENV || 'development';
    const logDir = 'logs';

    // Create the log directory if it does not exist
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir);
    }

    const tsFormat = () => (new Date()).toLocaleTimeString();

    const logger = new(winston.Logger)({
      transports: [
        // colorize the output to the console
        new(winston.transports.Console)({
          timestamp: tsFormat,
          colorize: true,
          level: 'info'
        }),
        new(winston.transports.File)({
          filename: `${logDir}/log.log`,
          timestamp: tsFormat,
          level: env === 'development' ? 'debug' : 'info'
        })
      ]
    });

    return logger;
  }

  function simulateMouseEvents(element, eventName) {
    var mouseEvent = document.createEvent('MouseEvents');
    mouseEvent.initEvent(eventName, true, true);
    element.dispatchEvent(mouseEvent);
  }
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
})();