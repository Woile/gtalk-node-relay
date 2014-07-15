var xmpp = require('node-xmpp');

var express = require('express');
var bodyParser = require('body-parser');
var nunjucks  = require('nunjucks');
var config = require('./config');

var models = require("./models");
var User = models.User;
var ChatLog = models.ChatLog;


/* XMPP Gtalk Data */
// Establish a connection
var conn = new xmpp.Client({
    jid         : config.jid,
    password    : config.password,
    host        : 'talk.google.com',
    port        : 5222
});

//conn.socket.setTimeout(0);
//conn.socket.setKeepAlive(true, 10000);


/* express app */
var app = express();

/*nunjucks templating config */
var nunjucksEnv = nunjucks.configure('views', {
    autoescape: true,
    express   : app
});

nunjucksEnv.addFilter("linebreaksbr", function(str){
    return str.replace(/\n/g, "<br>");
});

/*statics files*/
app.use("/static/", express.static(__dirname + '/static/'));
app.use(bodyParser.urlencoded({ extended: true }));


//Key = JID
//Value = User 
FriendsList = {

};

messagesQueue = []; //list of callbacks
setInterval(function(){
    try{
        messagesQueue.shift()();
    }catch(e){}
}, config.delay); //up to 7.69 messages per sec

function hasLink(text){
    var exp = /(https?:\/\/)?(www\.)?[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,4}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)/;
    var regex = new RegExp(exp);
    return text.match(regex) != null;
}

function setStatusMessage(status_message) {
   var presenceElem = new xmpp.Element('presence', { })
                               .c('show').t('chat').up()
                               .c('status').t(status_message);
   conn.send(presenceElem);
}


function requestGoogleRoster(){
    console.log("Get Roster");   
    var rosterElem = new xmpp.Element('iq', { 
                                from: conn.jid,
                                type: 'get',
                                id: 'google-roster'
                            }).c('query', {
                                xmlns: 'jabber:iq:roster',
                                'xmlns:gr': 'google:roster',
                                'gr:ext': '2' 
                            });
    conn.send(rosterElem);
}

function subscribeToJID(jid){
    var subscribeElem = new xmpp.Element('presence', {
        to: jid,
        type: 'subscribed'
    });
    conn.send(subscribeElem);
}

function acceptSubscriptionRequests(stanza) {
    if( stanza.is('presence') && stanza.attrs.type === 'subscribe'){
        subscribeToJID(stanza.attrs.from);
    }
}

function sendMessage(to_jid, messageBody, sync) {
    var elem = new xmpp.Element('message', { to: to_jid, type: 'chat' })
        .c('body').t(messageBody);
    if( sync ){
        conn.send(elem);
        //console.log('[message] SENT: ' + elem.up().toString());
        console.log('[SENT]:'+messageBody);
    }else{
        messagesQueue.push(function(){
            conn.send(elem);
            //console.log('[message] SENT: ' + elem.up().toString());
            console.log('[SENT]:'+messageBody);        
        });
    }
}


ChatCommands = {};

ChatCommands["!help"] = function(from, args){
    var msg = [
        "!help or !?",
        "!who",
        "!nick [strings] or !nickname [strings]",
        "!hist  [number] or !history [number]"
        ].join("\n")
    sendMessage(from, msg);
};
ChatCommands["!?"] = ChatCommands["!help"];

ChatCommands["!who"] = function(from, args){
    var message = "Friends: \n";
    for( var f in FriendsList ){
        message += FriendsList[f].nickname+"\n";
    }
    message += "\n";
    sendMessage(from, message);
}

ChatCommands["!nickname"] = function(from, args){
    if( args.length > 0 ){
        FriendsList[from].nickname = args.join(" ");
        FriendsList[from].save();
        sendMessage(from, "Nickname changed to '"+args.join(" ")+"'");
    }else{
        sendMessage(from, "Use /nickname Your Name");
    }
}

ChatCommands["!nick"] = ChatCommands["!nickname"];

ChatCommands["!history"] = function(from, args){
    var limit = parseInt(args[0]) || 10;
    ChatLog.findAll({
        limit: limit,
        order: "-chatlogs.id",
        include: [ User ] 
    }).success(function(messages){
        var messageBody = "";
        for (var i = messages.length - 1; i >= 0; i--) {
            //reverse order
            if( messages[i].user ){
               messageBody += "["+messages[i].user.nickname+"]: "+messages[i].message +"\n";
            }
        };
        sendMessage(from, messageBody);
    });
};
ChatCommands["!hist"] = ChatCommands["!history"];


function processCommand(stanza){
    //returns true on command messages
    var messageBody = stanza.getChildText('body');
    if( null !== messageBody && messageBody[0] == "!" ){
        var split = messageBody.split(" ");
        if( ChatCommands[split[0]] != null ){
            var from = stanza.attrs.from.split("/")[0];
            ChatCommands[ split[0] ](from, split.slice(1));
            return true;
        }
    }
    return false;
}

function echoAll(stanza){
    if( ! stanza.is('message') ){ return }
    var from = stanza.attrs.from.split("/")[0];
    var name = FriendsList[from].nickname;
    var messageBody = stanza.getChildText('body');
    if( messageBody != null ){
        //log message
        ChatLog.create({
            jid: from,
            message: messageBody,
            hasLink: hasLink(messageBody)
        }).success(function(chatLog){
            if( FriendsList[chatLog.jid] != null ){
                FriendsList[chatLog.jid].addChat(chatLog);
            }
        });

        for( var jid in FriendsList ){
            if( from != jid ){
                sendMessage(jid, "["+name+"]: "+messageBody);
            }
        }
    }
}

function processGoogleRoster(stanza){
    if( stanza.id != "google-roster" ){ return }
    var items = stanza.getChild("query").getElementsByTagName("item");
    for (var i = 0; i < items.length; i++) {
        if( items[i].getAttribute("subscription") == "both" ){
            var jid = items[i].getAttribute("jid");
            var name = items[i].getAttribute("name");

            User.findOrCreate({
                jid: jid
            }, { 
                name: name, nickname: name
            }).success(function(user){
                FriendsList[user.jid] = user;
            });
        }
    };
}

function processPresence(stanza){
    if( stanza.is('presence') && stanza.attrs.type === "unavailable"){

    }else if( stanza.is('presence') ){

    }
}

function processErrorStanza(stanza){
    console.log('[error] ' + stanza.toString());     
    var from = stanza.attrs.from.split("/")[0];
    var messageBody = stanza.getChildText('body');
    if( messageBody != null ){
        sendMessage(from, messageBody);
        console.log("Retry Message: "+messageBody);
    }
}

function messageDispatcher(stanza) {
    if('error' === stanza.attrs.type) {
        processErrorStanza(stanza);
    } else if( stanza.is('message') ){
        if( !processCommand(stanza) ){
            console.log('[message] RECV: ' + stanza.toString());
            echoAll(stanza);            
        }
    }else{
       // console.log('[stanza] RECV: ' + stanza.toString());
    }
}

function updateRosterLoop(){
    setInterval(requestGoogleRoster, 60000);//one min
}

conn.on('online', function(){
    setStatusMessage("I'm always online");
    updateRosterLoop();
    requestGoogleRoster();
    console.log("Online");
});

conn.on('error', function(e){
    console.log("----------------------------------------------");
    console.log(e);   
});

if( config.autoSubscribe ){
    conn.addListener('stanza', acceptSubscriptionRequests);
}

conn.addListener('stanza', messageDispatcher);
conn.addListener('stanza', processGoogleRoster);
//conn.addListener('stanza', processPresence);
//conn.addListener('online', requestGoogleRoster);

app.route("/")
    .get(function(req, res){
        ChatLog.findAll({
            limit: 40,
            order: "chatlogs.id",
            include: [ User ] 
        }).success(function(messages){
            res.render('chat/log_index.html', { messages: messages }, function(err, html){
                res.send(html);            
            });
        });      
    });

if( config.webServer ){
    app.listen(config.listenPort);
}
