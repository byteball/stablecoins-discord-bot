const Discord = require('discord.js');
const conf = require('ocore/conf.js');

var discordClient = null;


initDiscord();

const defaultToken1Symbol = 'tokens1';
const defaultToken2Symbol = 'tokens1';
const defaultStablecoinSymbol = 'stablecoins';
const defaultReserveAssetSymbol = 'reserve asset';


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
	discordClient.user.setActivity(conf.curve_base_aa , {type: "WATCHING"}); 
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

function announceNewDeposit(curveAa, depositsAa, amount, stable_amount, owner, trigger_unit){

	const objEmbed = new Discord.MessageEmbed()
	.setColor('#0099ff')
	.setTitle('New deposit for ' + getCurveName(curveAa))
	.setDescription(linkToGui(curveAa))
	.addFields({name: "Locked", value: applyDecimals(amount, curveAa.asset2_decimals) + ' ' + (curveAa.asset2_symbol  || defaultToken2Symbol) }) 
	.addFields({name: "Minted", value: applyDecimals(stable_amount, depositsAa.asset_decimals) + ' ' + (depositsAa.asset_symbol  || defaultStablecoinSymbol) })
	.addFields({name: 'Owner', value: owner})
	.addFields({name: 'Trigger unit', value: '[' + trigger_unit + ']('+conf.explorer_base_url + trigger_unit+')'});

	sendToDiscord(objEmbed);
}

function announceClosingDeposit(curveAa, depositsAa, owner, id, stable_amount, token2_amount, trigger_unit){

	const objEmbed = new Discord.MessageEmbed()
	.setColor('#0099ff')
	.setTitle('Closed deposit for ' + getCurveName(curveAa))
	.setDescription(linkToGui(curveAa))
	.addFields({name: "Burnt", value: applyDecimals(stable_amount, depositsAa.asset_decimals) + ' ' + (depositsAa.asset_symbol  || defaultStablecoinSymbol)})
	.addFields({name: "Unlocked", value: applyDecimals(token2_amount, curveAa.asset2_decimals) + ' ' + (curveAa.asset2_symbol  || defaultToken2Symbol)})
	.addFields({name: "Id", value: '#'+ id})
	.addFields({name: 'Owner', value: owner})
	.addFields({name: 'Trigger unit', value: '[' + trigger_unit + ']('+conf.explorer_base_url + trigger_unit+')'});

	sendToDiscord(objEmbed);
}

function announceForceClosePending(curveAa, depositsAa, trigger_address, id, stable_amount, trigger_unit){

	const objEmbed = new Discord.MessageEmbed()
	.setColor('#0099ff')
	.setTitle('Pending deposit force close for ' + getCurveName(curveAa))
	.setDescription(linkToGui(curveAa))
	.addFields({
		name: "Amount sent", value: applyDecimals(stable_amount, depositsAa.asset_decimals) + ' ' + (depositsAa.asset_symbol  || defaultStablecoinSymbol),
	})
	.addFields({name: "Id", value: '#'+ id})
	.addFields({name: 'Closer', value: trigger_address})
	.addFields({name: 'Trigger unit', value: '[' + trigger_unit + ']('+conf.explorer_base_url + trigger_unit+')'});

	sendToDiscord(objEmbed);
}


function announceMovedCapacity(curveAa, trigger_address, amount, trigger_unit){

	const objEmbed = new Discord.MessageEmbed()
	.setColor('#0099ff')
	.setTitle('Capacity moved from slow to fast pool' + getCurveName(curveAa))
	.setDescription(linkToGui(curveAa))
	.addFields({
		name: "Amount", value: applyDecimals(amount, curveAa.reserve_asset_decimals) + ' ' + (curveAa.reserve_asset_symbol  || defaultReserveAssetSymbol),
	})
	.addFields({name: "Id", value: '#'+ id})
	.addFields({name: 'Author', value: trigger_address})
	.addFields({name: 'Trigger unit', value: '[' + trigger_unit + ']('+conf.explorer_base_url + trigger_unit+')'});

	sendToDiscord(objEmbed);

}


function announceParameterChange(curveAa, param, value){

	const objEmbed = new Discord.MessageEmbed()
	.setColor('#0099ff')
	.setTitle('Parameter changed for ' + getCurveName(curveAa))
	.setDescription(linkToGui(curveAa))
	.addFields(
		{ name: "Param", value: param, inline: true },
		{ name: "Value", value: value, inline: true },
		{ name: '\u200B', value: '\u200B' , inline: true 	}); // empty column to create a new row
	sendToDiscord(objEmbed);
}

function announceGrantAttributed(curveAa, grant, recipient, amount){
	const objEmbed = new Discord.MessageEmbed()
	.setColor('#0099ff')
	.setTitle('Grant attributed for ' + getCurveName(curveAa))
	.setDescription(linkToGui(curveAa) + 'Grant #'+grant +' attributed, ' + applyDecimals(amount, curveAa.asset1_decimals)+ curveAa.asset1_symbol + ' sent to ' + recipient);
	sendToDiscord(objEmbed);
}

function addPlus(amount){
	if (!amount)
		return '0';
	if (amount > 0)
		return '+' + amount;
	return amount.toString();
}

function announceSupplyChange(curveAa, reserve_added, asset1_added, asset2_added, p2, target_p2, trigger_unit){

	const objEmbed = new Discord.MessageEmbed()
	.setColor('#0099ff')
	.setTitle('Supply change for ' + getCurveName(curveAa))
	.setDescription(linkToGui(curveAa))
	.addFields(
		{
			name: "New p2 price",
			value: Math.pow(p2, 1 / (curveAa.leverage - 1)).toPrecision(6)
		},
		{
			name: "New p2 price target",
			value: Math.pow(target_p2, 1 / (curveAa.leverage - 1)).toPrecision(6)
		},
		{ name: "Supply change", value: [
			addPlus(applyDecimals(reserve_added, curveAa.reserve_asset_decimals)),
			addPlus(applyDecimals(asset1_added, curveAa.asset1_decimals)),
			addPlus(applyDecimals(asset2_added, curveAa.asset2_decimals)),
		], inline: true },
		{ name: "Asset", value: [
			(curveAa.reserve_asset_symbol || defaultReserveAssetSymbol),
			(curveAa.asset1_symbol  || defaultToken1Symbol),
			(curveAa.asset2_symbol  || 'token2')
		], inline: true 
		},
		{ name: '\u200B', value: '\u200B' , inline: true 	})// empty column to create a new row
		.addFields({name: 'Trigger unit', value: '[' + trigger_unit + ']('+conf.explorer_base_url + trigger_unit+')'});
	sendToDiscord(objEmbed);

}


function announceAddedSupport(curveAa, trigger_address, amountToAa, param, value, support, leader, leader_support, trigger_unit){

	const objEmbed = new Discord.MessageEmbed()
	.setColor('#0099ff')
	.setTitle('New parameter change support for ' + getCurveName(curveAa))
	.setDescription(linkToGui(curveAa) + trigger_address +' adds ' + applyDecimals(amountToAa, curveAa.asset1_decimals) + ' ' + (curveAa.asset1_symbol || defaultToken1Symbol) + ' in support to value `' + value +'` for parameter `'+param +'`')
	.addFields(
		{ name: "Value", value: value, inline: true },
		{ name: "Support", value: applyDecimals(support, curveAa.asset1_decimals) + ' ' + (curveAa.asset1_symbol || defaultToken1Symbol), inline: true},
		{ name: '\u200B', value: '\u200B' , inline: true 	}
	).addFields(
		{ name: "Leader value", value: leader, inline: true },
		{ name: "Support", value: applyDecimals(leader_support, curveAa.asset1_decimals) + ' ' + (curveAa.asset1_symbol || defaultToken1Symbol), inline: true},
		{ name: '\u200B', value: '\u200B' , inline: true 	}
	).addFields({name: 'Trigger unit', value: '[' + trigger_unit + ']('+conf.explorer_base_url + trigger_unit+')'});
	
	sendToDiscord(objEmbed);

}

function announceRemovedSupport(curveAa, trigger_address, param, leader, leader_support, trigger_unit){
	const objEmbed = new Discord.MessageEmbed()
	.setColor('#0099ff')
	.setTitle('Parameter change support removed for ' + getCurveName(curveAa))
	.setDescription(linkToGui(curveAa) + trigger_address +' removes its vote about parameter ' + param)
	.addFields(
		{ name: "Leader value", value: leader, inline: true },
		{ name: "Support", value: applyDecimals(leader_support, curveAa.asset1_decimals) + ' ' + (curveAa.asset1_symbol || defaultToken1Symbol), inline: true },
	)
	.addFields({name: 'Trigger unit', value: '[' + trigger_unit + ']('+conf.explorer_base_url + trigger_unit+')'});
	
	sendToDiscord(objEmbed);
}



exports.announceAddedSupport = announceAddedSupport;
exports.announceNewDeposit = announceNewDeposit;
exports.announceClosingDeposit = announceClosingDeposit;
exports.announceParameterChange = announceParameterChange;
exports.announceGrantAttributed = announceGrantAttributed;
exports.announceSupplyChange = announceSupplyChange;
exports.announceRemovedSupport = announceRemovedSupport;
exports.announceForceClosePending = announceForceClosePending;
exports.announceMovedCapacity = announceMovedCapacity;