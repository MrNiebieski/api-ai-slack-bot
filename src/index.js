// Module must be started with environment variables
//
//  accesskey="api.ai client access key"
//  slackkey="slack bot key"
//

'use strict';

const Botkit = require('botkit');

const apiai = require('apiai');
const uuid = require('node-uuid');
const http = require('http');

const Entities = require('html-entities').XmlEntities;
const decoder = new Entities();

const apiAiAccessToken = process.env.accesstoken;
const slackBotKey = process.env.slackkey;
const dashBotKey = process.env.dashbotkey;

const apiAiService = apiai(apiAiAccessToken);
const dashbot = require('dashbot')(dashBotKey).slack;

const sessionIds = new Map();
const pausedChannels = {}

const controller = Botkit.slackbot({
    debug: true
    //include "log: false" to disable logging
});

controller.middleware.receive.use(dashbot.receive);
controller.middleware.send.use(dashbot.send);

var bot = controller.spawn({
    token: slackBotKey
}).startRTM();

controller.on('rtm_close', function (bot, err) {
    console.log('** The RTM api just closed, reason', err);
    
    try {

        // sometimes connection closing, so, we should restart bot
        if (bot.doNotRestart != true) {
            let token = bot.config.token;
            console.log('Trying to restart bot ' + token);

            restartBot(bot);
        }

    } catch (err) {
        console.error('Restart bot failed', err);
    }
});

function restartBot(bot) {
    bot.startRTM(function (err) {
        if (err) {
            console.error('Error restarting bot to Slack:', err);
        }
        else {
            let token = bot.config.token;
            console.log('Restarted bot for %s', token);
        }
    });
}

function isDefined(obj) {
    if (typeof obj == 'undefined') {
        return false;
    }

    if (!obj) {
        return false;
    }

    return obj != null;
}

controller.hears(['.*'], ['direct_message', 'direct_mention', 'mention', 'ambient'], (bot, message) => {
    try {
        const channelId = message.channel
        const teamId = bot.team_info.id
        if (pausedChannels[channelId+'-'+teamId]) {
          return
        }
        if (message.type == 'message') {
            if (message.user == bot.identity.id) {
                // message from bot can be skipped
            }
            else if (message.text.indexOf("<@U") == 0 && message.text.indexOf(bot.identity.id) == -1) {
                // skip other users direct mentions
            }
            else {

                let requestText = decoder.decode(message.text);
                requestText = requestText.replace("’", "'");

                let channel = message.channel;
                let messageType = message.event;
                let botId = '<@' + bot.identity.id + '>';
                let userId = message.user;

                console.log(requestText);
                console.log(messageType);

                if (requestText.indexOf(botId) > -1) {
                    requestText = requestText.replace(botId, '');
                }

                if (!sessionIds.has(channel)) {
                    sessionIds.set(channel, uuid.v1());
                }

                console.log('Start request ', requestText);
                let request = apiAiService.textRequest(requestText,
                    {
                        sessionId: sessionIds.get(channel),
                        contexts: [
                            {
                                name: "generic",
                                parameters: {
                                    slack_user_id: userId,
                                    slack_channel: channel
                                }
                            }
                        ]
                    });

                request.on('response', (response) => {
                    console.log(response);

                    if (isDefined(response.result)) {
                        let responseText = response.result.fulfillment.speech;
                        let responseData = response.result.fulfillment.data;

                        if (isDefined(responseData) && isDefined(responseData.slack)) {
                            replyWithData(bot, message, responseData);
                        } else if (isDefined(responseText)) {
                            replyWithText(bot, message, responseText);
                        }

                    }
                });

                request.on('error', (error) => console.error(error));
                request.end();
            }
        }
    } catch (err) {
        console.error(err);
    }
});

function replyWithText(bot, message, responseText) {
    bot.reply(message, responseText, (err, resp) => {
        if (err) {
            console.error(err);
        }
});
}

function replyWithData(bot, message, responseData) {
    try {
        bot.reply(message, responseData.slack);
    } catch (err) {
        bot.reply(message, err.message);
    }
}

// For pause
const express = require('express');
const bodyParser = require('body-parser');

const webserver = express()
webserver.use(bodyParser.json());
webserver.route('/').get(function(req, res) {
  res.send('Hi');
});
webserver.route('/pause').post(function(req, res) {
  console.log('Got request', req.body)
  pausedChannels[req.body.channelId+'-'+req.body.teamId] = req.body.paused
  res.send('{"success":true}')
});

// var port = 4000;
// webserver.listen(port);
// console.log('http://localhost:' + port);

// console.log('Slack bot ready');

//Create a server to prevent Heroku kills the bot
// const server = http.createServer((req, res) => res.end());

//Lets start our server
webserver.listen((process.env.PORT || 5000), () => console.log("Server listening"));