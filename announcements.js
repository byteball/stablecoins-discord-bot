const Discord = require('discord.js');
const conf = require('ocore/conf.js');

var discordClient = null;

initDiscord();

const defaultToken1Symbol = 'tokens1';

async function initDiscord(){
	if (!conf.discord_token)
		throw Error("discord_token missing in conf");
	if (!conf.discord_channels || !conf.discord_channels.length)
		throw Error("channels missing in conf");
	discordClient = new Discord.Client();
	discordClient.on('ready', () => {
		console.log(`Logged in Discord as ${discordClient.user.tag}!`);
	});
	discordClient.on('error', (error) => {
		console.log(`Discord error: ${error}`);
	});
	await discordClient.login(conf.discord_token);
	setBotActivity();
	setInterval(setBotActivity, 1000 * 60 * 24);

}

function setBotActivity(){
	discordClient.user.setActivity("stablecoin governance AAs" , {type: "WATCHING"}); 
}


function sendToDiscord(to_be_sent){
	if (!discordClient)
		return console.log("discord client not initialized");
	if (process.env.mute)
		return console.log("client muted");
	conf.discord_channels.forEach(function(channelId){
			discordClient.channels.fetch(channelId).then(function(channel){
				channel.send(to_be_sent);
			});
	});
}

function getCurveName(curveAa){
	return curveAa.aa_address + (curveAa.asset2_symbol ? (' - ' + curveAa.asset2_symbol) : '') + ' - ' + curveAa.interest_rate * 100 + '%';
}

function applyDecimals(amount, decimals){
	if (!amount)
		return 0;
	return amount / (10 ** decimals);
}

function linkToGui(curveAa){
	return '[View on interface](' + conf.stablecoins_base_url + curveAa.aa_address+')\n\n';

}

function announceAddedSupport(curveAa, trigger_address, amountToAa, param, value, support, leader, leader_support, trigger_unit, version){
	const decimals = (version === 1 ? curveAa.asset1_decimals : curveAa.reserve_asset_decimals);
	const symbol = (version === 1 ? curveAa.asset1_symbol : curveAa.fund_asset_symbol);
	const objEmbed = new Discord.MessageEmbed()
	.setColor('#0099ff')
	.setTitle('New parameter change support for ' + getCurveName(curveAa))
	.setDescription(linkToGui(curveAa) + trigger_address +' adds ' + applyDecimals(amountToAa, decimals) + ' ' + (symbol || defaultToken1Symbol) + ' in support to value `' + value +'` for parameter `'+param +'`')
	.addFields(
		{ name: "Value", value: value, inline: true },
		{ name: "Support", value: applyDecimals(support, decimals) + ' ' + (symbol || defaultToken1Symbol), inline: true},
		{ name: '\u200B', value: '\u200B' , inline: true 	}
	).addFields(
		{ name: "Leader value", value: leader, inline: true },
		{ name: "Support", value: applyDecimals(leader_support, decimals) + ' ' + (symbol || defaultToken1Symbol), inline: true},
		{ name: '\u200B', value: '\u200B' , inline: true 	}
	).addFields({name: 'Trigger unit', value: '[' + trigger_unit + ']('+conf.explorer_base_url + trigger_unit+')'});
	
	sendToDiscord(objEmbed);

}

function announceRemovedSupport(curveAa, trigger_address, param, leader, leader_support, trigger_unit, version){
	const decimals = (version === 1 ? curveAa.asset1_decimals : curveAa.reserve_asset_decimals);
	const symbol = (version === 1 ? curveAa.asset1_symbol : curveAa.fund_asset_symbol);
	const objEmbed = new Discord.MessageEmbed()
	.setColor('#0099ff')
	.setTitle('Parameter change support removed for ' + getCurveName(curveAa))
	.setDescription(linkToGui(curveAa) + trigger_address +' removes its vote about parameter ' + param)
	.addFields(
		{ name: "Leader value", value: leader, inline: true },
		{ name: "Support", value: applyDecimals(leader_support, decimals) + ' ' + (symbol || defaultToken1Symbol), inline: true },
	)
	.addFields({name: 'Trigger unit', value: '[' + trigger_unit + ']('+conf.explorer_base_url + trigger_unit+')'});
	
	sendToDiscord(objEmbed);
}

function announceCommitedValue(curveAa, trigger_address, param, value, trigger_unit) {
	const objEmbed = new Discord.MessageEmbed()
	.setColor('#0099ff')
	.setTitle('New parameter value commited for ' + getCurveName(curveAa))
	.setDescription(linkToGui(curveAa) + trigger_address +' commited value `' + value +'` for parameter `'+param +'`')
	.addFields(
		{ name: "Parameter", value: param, inline: true },
		{ name: "Value", value: value, inline: true},
		{ name: '\u200B', value: '\u200B' , inline: true 	}
	).addFields({name: 'Trigger unit', value: '[' + trigger_unit + ']('+conf.explorer_base_url + trigger_unit+')'});
	
	sendToDiscord(objEmbed);
}

function announceWithdrawn(curveAa, trigger_address, amount, trigger_unit, version) {
	const decimals = (version === 1 ? curveAa.asset1_decimals : curveAa.reserve_asset_decimals);
	const symbol = (version === 1 ? curveAa.asset1_symbol : curveAa.fund_asset_symbol);
	const objEmbed = new Discord.MessageEmbed()
	.setColor('#0099ff')
	.setTitle('Balance withdrawn from ' + getCurveName(curveAa))
	.setDescription(linkToGui(curveAa) + trigger_address +' has withdrawn `' + applyDecimals(amount, decimals) + ' ' + (symbol || defaultToken1Symbol) +'` from their balance')
	.addFields({name: 'Trigger unit', value: '[' + trigger_unit + ']('+conf.explorer_base_url + trigger_unit+')'});
	
	sendToDiscord(objEmbed);
}

exports.announceAddedSupport = announceAddedSupport;
exports.announceRemovedSupport = announceRemovedSupport;
exports.announceCommitedValue = announceCommitedValue;
exports.announceWithdrawn = announceWithdrawn;