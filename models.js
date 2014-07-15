var Sequelize = require('sequelize');

/* Init the db */
var sequelize = new Sequelize('', '', '', {
    dialect: "sqlite",      
    storage: "chatbot.sqlite",
    logging: false
});

/* Models */ 
var ChatLog = sequelize.define('chatlog', {
    jid:      Sequelize.STRING,
    message:  Sequelize.TEXT,    
    hasLink:  { type: Sequelize.BOOLEAN, defaultValue: false } 
});

var User = sequelize.define('user', {
    jid:      Sequelize.STRING,
    name:     Sequelize.STRING,
    nickname: Sequelize.STRING
});

User.hasMany(ChatLog, {as: 'chats'});
ChatLog.belongsTo(User);

/* Auth DB */
sequelize.authenticate()

/* Sync Models */
sequelize.sync();

module.exports = {
	ChatLog: ChatLog,
	User: User,
	sequelize:sequelize
};