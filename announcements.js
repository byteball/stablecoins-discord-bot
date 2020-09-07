const Discord = require('discord.js');
const moment = require('moment');
const conf = require('ocore/conf.js');

var discordClient = null;


initDiscord();


async function initDiscord(){
console.log(conf);
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
	discordClient.user.setActivity(conf.curve_base_aa , {type: "WATCHING"}); 
}


function sendToDiscord(to_be_sent){
	if (!discordClient)
		return console.log("discord client not initialized");
	conf.discord_channels.forEach(function(channelId){
			discordClient.channels.fetch(channelId).then(function(channel){
				channel.send(to_be_sent);
			});
	});
}

function getCurveName(curveAa){
	return curveAa.aa_address.slice(0,16) + '... ' + curveAa.asset_2_symbol + ' - ' + curveAa.interest_rate + '%';
}

function applyDecimals(amount, decimals){
	if (!amount)
		return 0;
	return amount / (10 ** decimals);
}

function linkToGui(curveAa){
	return '[View on interface](' + conf.stablecoins_base_url + curveAa.aa_address+')\n\n';

}

function announceNewDeposit(curveAa, depositsAa, amount, stable_amount, owner, trigger_unit){

	const objEmbed = new Discord.MessageEmbed()
	.setColor('#0099ff')
	.setTitle(getCurveName(curveAa))
	.setDescription(owner +' deposits ' + applyDecimals(amount, curveAa.asset2_decimals) + curveAa.asset2_symbol + ' and gets ' 
	+ applyDecimals(stable_amount, depositsAa.asset_decimals) + depositsAa.asset_symbol )
	.addFields({name: 'Trigger unit', value: '[' + trigger_unit + ']('+conf.explorer_base_url + trigger_unit+')'});

	sendToDiscord(objEmbed);
}

function announceClosingDeposit(curveAa, depositsAa, author, id, bForceClose,  stable_token_to_aa_amount, interest_token_from_aa_amount, trigger_unit){
	var description = linkToGui(curveAa)
	description += bForceClose ? author + ' force closes deposit #' + id : 
	author +' closes deposit #'+ id +' with ' + applyDecimals(stable_token_to_aa_amount, depositsAa.asset_decimals) + ' ' + (curveAa.asset2_symbol || 'tokens2') + ' and unlocks ' 
	+ applyDecimals(interest_token_from_aa_amount, curveAa.asset2_decimals) +  ' ' + (curveAa.asset2_symbol || 'tokens2');

	const objEmbed = new Discord.MessageEmbed()
	.setColor('#0099ff')
	.setTitle(getCurveName(curveAa))
	.setDescription(description)
	.addFields({name: 'Trigger unit', value: '[' + trigger_unit + ']('+conf.explorer_base_url + trigger_unit+')'});

	sendToDiscord(objEmbed);
}

function announceParameterChange(curveAa, param, value){

	const objEmbed = new Discord.MessageEmbed()
	.setColor('#0099ff')
	.setTitle(getCurveName(curveAa))
	.setDescription(linkToGui(curveAa) + 'Parameter changed')
	.addFields(
		{ name: "Param", value: param, inline: true  },
		{ name: "Value", value: value, inline: true },
		{ name: '\u200B', value: '\u200B' , inline: true 	}); // empty column to create a new row
	sendToDiscord(objEmbed);
}

function announceGrantAttributed(curveAa, grant, recipient, amount){
	const objEmbed = new Discord.MessageEmbed()
	.setColor('#0099ff')
	.setTitle(getCurveName(curveAa))
	.setDescription('Grant #'+grant +' attributed, ' + applyDecimals(amount, curveAa.asset1_decimals)+ curveAa.asset1_symbol + ' sent to ' + recipient);
	sendToDiscord(objEmbed);

}

function addPlus(amount){
	if (!amount)
		return '0';
	if (amount > 0)
		return '+' + amount;
	return amount.toString();
}

function announceSupplyChange(curveAa, reserve_added, asset1_added, asset2_added, p2, trigger_unit){
	const objEmbed = new Discord.MessageEmbed()
	.setColor('#0099ff')
	.setTitle(getCurveName(curveAa))
	.setDescription('Supply changed, new price p2: ' + p2)
	.addFields(
		{ name: "Asset", value: [
			(curveAa.reserve_asset_symbol || 'reserve asset'),
			(curveAa.asset1_symbol  || 'token1'),
			(curveAa.asset2_symbol  || 'token2')
		], inline: true 
		},
		{ name: "Supply change", value: [
			addPlus(applyDecimals(reserve_added, curveAa.reserve_asset_decimals)),
			addPlus(applyDecimals(asset1_added, curveAa.asset1_decimals)),
			addPlus(applyDecimals(asset2_added, curveAa.asset2_decimals)),
		], inline: true },
		{ name: '\u200B', value: '\u200B' , inline: true 	})// empty column to create a new row
		.addFields({name: 'Trigger unit', value: '[' + trigger_unit + ']('+conf.explorer_base_url + trigger_unit+')'});
	sendToDiscord(objEmbed);

}


function announceAddedSupport(curveAa, trigger_address, amountToAa, param, value, support, leader, leader_support, trigger_unit){

	const objEmbed = new Discord.MessageEmbed()
	.setColor('#0099ff')
	.setTitle(getCurveName(curveAa))
	.setDescription(trigger_address +' adds ' + applyDecimals(amountToAa, curveAa.asset1_decimals) + ' ' + (curveAa.asset1_symbol || 'token1') + ' in support to value `' + value +'` for parameter `'+param +'`')
	.addFields(
		{ name: "Value", value: value, inline: true },
		{ name: "Support", value: applyDecimals(support, curveAa.asset1_decimals) + ' ' + (curveAa.asset1_symbol || 'token1'), inline: true},
		{ name: '\u200B', value: '\u200B' , inline: true 	}
	).addFields(
		{ name: "Leader value", value: leader, inline: true },
		{ name: "Support", value: applyDecimals(leader_support, curveAa.asset1_decimals) + ' ' + (curveAa.asset1_symbol || 'token1'), inline: true},
		{ name: '\u200B', value: '\u200B' , inline: true 	}
	).addFields({name: 'Trigger unit', value: '[' + trigger_unit + ']('+conf.explorer_base_url + trigger_unit+')'});
	
	sendToDiscord(objEmbed);

}

function announceRemovedSupport(curveAa, trigger_address, param, leader, leader_support, trigger_unit){
	const objEmbed = new Discord.MessageEmbed()
	.setColor('#0099ff')
	.setTitle(getCurveName(curveAa))
	.setDescription(trigger_address +' removes its vote about parameter ' + param)
	.addFields(
		{ name: "Leader value", value: leader, inline: true },
		{ name: "Support", value: applyDecimals(leader_support, curveAa.asset1_decimals) + ' ' + (curveAa.asset1_symbol || 'token1'), inline: true },
	)
	.addFields({name: 'Trigger unit', value: '[' + trigger_unit + ']('+conf.explorer_base_url + trigger_unit+')'});

	
	sendToDiscord(objEmbed);
}


function convertToGbString (amount){
	return (amount/1e9 >=1 ? ((amount/1e9).toPrecision(6)/1).toLocaleString(): ((amount/1e9).toPrecision(6)/1)) + ' GB'
}


exports.announceAddedSupport = announceAddedSupport;
exports.announceNewDeposit = announceNewDeposit;
exports.announceClosingDeposit = announceClosingDeposit;
exports.announceParameterChange = announceParameterChange;
exports.announceGrantAttributed = announceGrantAttributed;
exports.announceSupplyChange = announceSupplyChange;
exports.announceRemovedSupport = announceRemovedSupport;