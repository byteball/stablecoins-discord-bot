const conf = require('ocore/conf.js');
const network = require('ocore/network.js');
const eventBus = require('ocore/event_bus.js');
const lightWallet = require('ocore/light_wallet.js');
const storage = require('ocore/storage.js');
const walletGeneral = require('ocore/wallet_general.js');
const objectHash = require('ocore/object_hash.js');
const announcements = require('./announcements.js');
const crypto = require('crypto');

var assocCurveAas = {};

var assocDepositsAas = {};
var assocDepositsAasByCurves = {};

var assocGovernanceAas = {};


lightWallet.setLightVendorHost(conf.hub);

eventBus.on('connected', function(ws){
	network.initWitnessesIfNecessary(ws, start);
});


function getValueKey(value){
	return ('support_' + 'oracles' +'_' + value+ '_'+ 32).length > 128 ? 
	crypto.createHash("sha256").update(value, "utf8").digest("base64") : value;
}

async function treatResponseFromGovernanceAA(objResponse){

	const objTriggerUnit = await storage.readUnit(objResponse.trigger_unit);
	if (!objTriggerUnit)
		throw Error('trigger unit not found ' + objResponse.trigger_unit);
	const data = getTriggerUnitData(objTriggerUnit);
	const governanceAaAddress = objResponse.aa_address;
	const governanceAa = assocGovernanceAas[governanceAaAddress];
	if (data.name){
		if (data.value === undefined){
			const leader_key = 'leader_' + data.name;
			var registryVars = await getStateVarsForPrefixes(governanceAaAddress, [leader_key]);
			const leader = registryVars[leader_key];
			const leader_support_key = 'leader_' + leader;
			registryVars = await getStateVarsForPrefixes(governanceAaAddress, [leader_support_key]);
			const leader_support = registryVars[leader_support_key];
			return announcements.announceRemovedSupport(assocCurveAas[governanceAa.curveAaAddress], objResponse.trigger_address, data.name, leader, 
			leader_support, objResponse.trigger_unit);
		}
		const support_key = 'support_' + data.name + '_' + getValueKey(data.value);
		const leader_key = 'leader_' + data.name;
		var registryVars = await getStateVarsForPrefixes(governanceAaAddress, [leader_key, support_key]);

		const support = registryVars[support_key];
		const leader = registryVars[leader_key];
		const leader_support_key = 'leader_' + leader;
		registryVars = await getStateVarsForPrefixes(governanceAaAddress, [leader_support_key]);
		const leader_support = registryVars[leader_support_key];

		const amountToAa = getAmountToAa(objTriggerUnit, governanceAaAddress, governanceAa.asset);

		return announcements.announceAddedSupport(assocCurveAas[governanceAa.curveAaAddress], objResponse.trigger_address, amountToAa, data.name,data.value,
			support, leader, leader_support, objResponse.trigger_unit);
	}

}


async function treatResponseFromDepositsAA(objResponse){
	console.log(' ________________________________ treatResponseFromDepositsAA');
	console.log(JSON.stringify(objResponse));

	const objTriggerUnit = await storage.readUnit(objResponse.trigger_unit);
	if (!objTriggerUnit)
		throw Error('trigger unit not found ' + objResponse.trigger_unit);
	const data = getTriggerUnitData(objTriggerUnit);

	const objResponseUnit = objResponse.response_unit ? await storage.readUnit(objResponse.response_unit) : null;
	const depositAaAddress = objResponse.aa_address;
	const depositsAa = assocDepositsAas[depositAaAddress]
	const curveAaAddress = depositsAa.curveAaAddress;
	const curveAa = assocCurveAas[curveAaAddress];
	if (objResponse.response.responseVars && objResponse.response.responseVars.id){
		const deposit_id = 'deposit_' + objResponse.response.responseVars.id;
		const vars = await getStateVarsForPrefix(depositAaAddress, deposit_id);
		if (!vars[deposit_id])
			return console.log('no vars found for deposit ' + deposit_id);
		return announcements.announceNewDeposit(curveAa, depositsAa, vars[deposit_id].amount, vars[deposit_id].stable_amount, vars[deposit_id].owner, objResponse.trigger_unit);
	} 

	const stable_token_to_aa_amount = getAmountToAa(objTriggerUnit, depositAaAddress, depositsAa.asset) - getAmountFromAa(objResponseUnit, depositAaAddress, depositsAa.asset)

	if (stable_token_to_aa_amount > 0 && data.id){
		const interest_token_from_aa_amount =  getAmountFromAa(objResponseUnit, depositAaAddress, curveAa.asset2)
		const vars = getStateVarsForPrefix(depositAaAddress, 'deposit_' + data.id + '_force_close');

		return announcements.announceClosingDeposit(curveAa, depositsAa, objResponse.trigger_address, data.id, !!vars[ 'deposit_' + data.id + '_force_close'],  
		stable_token_to_aa_amount, interest_token_from_aa_amount, objResponse.trigger_unit);
	}
	
}

async function treatResponseFromCurveAA(objResponse){
	const objTriggerUnit = await storage.readUnit(objResponse.trigger_unit);
	if (!objTriggerUnit)
		throw Error('trigger unit not found ' + objResponse.trigger_unit);
	const objResponseUnit = objResponse.response_unit ? await storage.readUnit(objResponse.response_unit) : null;
	const data = getTriggerUnitData(objTriggerUnit);
//	const amount = getByteAmountToAA(objTriggerUnit, objResponse.aa_address);
	const curveAa = assocCurveAas[objResponse.aa_address];
	const curveAaAddress = objResponse.aa_address;
	if (data.move_capacity && objResponse.response.amount)
		return announcements.announceMovedCapacity(curveAa, objResponse.trigger_address, objResponse.response.amount);
	if (objResponse.trigger_address == curveAa.governance_aa && data.name){
		announcements.announceParameterChange(curveAa, data.name, data.value);
		return;// saveAllCurveAaParams(objAa.address); // refresh with new param
	}
	if (objResponse.trigger_address == curveAa.governance_aa && data.grant && data.recipient && data.amount)
		return announcements.announceGrantAttributed(curveAa, data.grant, data.recipient, data.amount);
	if (objResponse.response.responseVars && objResponse.response.responseVars.p2){
		const reserve_added = getAmountToAa(objTriggerUnit, curveAaAddress, curveAa.reserve_asset) - getAmountFromAa(objResponseUnit, curveAaAddress, curveAa.reserve_asset); // can be negative
		const asset1_added = getAmountFromAa(objResponseUnit, curveAaAddress, curveAa.asset1) - getAmountToAa(objTriggerUnit, curveAaAddress, curveAa.asset1); // can be negative
		const asset2_added = getAmountFromAa(objResponseUnit, curveAaAddress, curveAa.asset2) - getAmountToAa(objTriggerUnit, curveAaAddress, curveAa.asset2); // can be negative

		return announcements.announceSupplyChange(curveAa, reserve_added, asset1_added, asset2_added, objResponse.response.responseVars.p2, objResponse.trigger_unit)

	}

		
		//trigger.address == var['governance_aa'] AND $allow_grants AND trigger.data.grant AND trigger.data.recipient AND trigger.data.amount 
}


eventBus.on('aa_response', function(objResponse){
	console.log('---------------------------------------------- aa_response ');
	if(objResponse.response.error)
		return console.log('ignored response with error: ' + objResponse.response.error);
	const aa_address = objResponse.aa_address;

	if (assocCurveAas[aa_address]){
		treatResponseFromCurveAA(objResponse);
	}

	if (assocDepositsAas[aa_address]){
		treatResponseFromDepositsAA(objResponse);
	}

	if (assocGovernanceAas[aa_address]){
		treatResponseFromGovernanceAA(objResponse);
	}

});

function getAmountFromAa(objResponseUnit, aa_address, asset = 'base'){
	if (!objResponseUnit)
		return 0;
	let amount = 0;
	objResponseUnit.messages.forEach(function (message){
		if (message.app !== 'payment')
			return;
		const payload = message.payload;
		if (asset == 'base' && payload.asset || asset != 'base' && asset !== payload.asset)
			return;
		payload.outputs.forEach(function (output){
			if (output.address !== aa_address) {
				amount += output.amount; 
			} 
		});
	});
	return amount;
}


function getAmountToAa(objTriggerUnit, aa_address, asset = 'base'){

	if (!objTriggerUnit)
		return 0;
	let amount = 0;
	objTriggerUnit.messages.forEach(function (message){
		if (message.app !== 'payment')
			return;
		const payload = message.payload;
		if (asset == 'base' && payload.asset || asset != 'base' && asset !== payload.asset)
			return;
		payload.outputs.forEach(function (output){
			if (output.address === aa_address) {
				amount += output.amount; // in case there are several outputs
			}
		});
	});
	return amount;
}

function getTriggerUnitData(objTriggerUnit){
	for (var i=0; i < objTriggerUnit.messages.length; i++)
	if (objTriggerUnit.messages[i].app === 'data') // AA considers only the first data message
		return objTriggerUnit.messages[i].payload;
	return {};
}




async function start(){

	network.addLightWatchedAa(conf.curve_base_aa, null, err => {
		if (err)
			throw Error(err);
	});
	lookForExistingStablecoins()

	setInterval(lightWallet.refreshLightClientHistory, 60*1000);
}

function lookForExistingStablecoins(){
	discoverCurveAas();
	discoverDepositAas();
}


async function discoverDepositAas(){
	network.requestFromLightVendor('light/get_aas_by_base_aas', {
		base_aa: conf.deposit_base_aa
	}, function(ws, request, arrResponse){
		console.log(arrResponse);

		Promise.all(arrResponse.map(watchDepositsAa))
	});
}

async function watchDepositsAa(objAa){
	walletGeneral.addWatchedAddress(objAa.address, () => {
		saveAllDepositsParams(objAa);
	});
}


async function saveAllDepositsParams(objAa){
	const depositsAaAddress = objAa.address;
	const curveAaAddress = objAa.definition[1].params.curve_aa;

	const vars = await getStateVars(depositsAaAddress);
	const asset = vars['asset'];
	const registryVars = await getStateVarsForPrefixes(conf.token_registry_aa_address, ['a2s_' + asset, 'decimals_' + asset]);

	assocDepositsAas[depositsAaAddress] = {
		asset,
		asset_symbol: registryVars['a2s_' + asset],
		asset_decimals: registryVars['decimals_' + asset],
		curveAaAddress
	}
	assocDepositsAasByCurves[curveAaAddress] = assocDepositsAas[depositsAaAddress];
	console.log(assocDepositsAasByCurves[curveAaAddress]);
}


async function discoverCurveAas(){
	network.requestFromLightVendor('light/get_aas_by_base_aas', {
		base_aa: conf.curve_base_aa
	}, function(ws, request, arrResponse){
		console.log(arrResponse);
		Promise.all(arrResponse.map(watchCurveAa))
	});
}

async function watchCurveAa(objAa){
	walletGeneral.addWatchedAddress(objAa.address, () => {
		saveAllCurveAaParams(objAa);
	});
}

async function watchGovernanceAa(governanceAaAddress, curveAaAddress){
	walletGeneral.addWatchedAddress(governanceAaAddress, () => {
			assocGovernanceAas[governanceAaAddress] = {
				asset: assocCurveAas[curveAaAddress].asset1,
				curveAaAddress
			}
	});
}

async function saveAllCurveAaParams(objAa){
	const curveAaAddress = objAa.address;
	const reserve_asset = objAa.definition[1].params.reserve_asset;

	const curveAaVars = await getStateVars(curveAaAddress);
	const registryVars = await getStateVarsForPrefixes(conf.token_registry_aa_address, ['a2s_' + curveAaVars.asset1, 'a2s_' + curveAaVars.asset2, 'a2s_' + reserve_asset, 'decimals_' + reserve_asset]);
	
	assocCurveAas[curveAaAddress] = {
		aa_address: curveAaAddress,
		governance_aa: curveAaVars.governance_aa,
		asset1: curveAaVars.asset1,
		asset2: curveAaVars.asset2,
		interest_rate: curveAaVars.interest_rate,
		asset1_decimals: objAa.definition[1].params.decimals1,
		asset2_decimals: objAa.definition[1].params.decimals2,
		asset_1_symbol: registryVars['a2s_' + curveAaVars.asset1],
		asset_2_symbol: registryVars['a2s_' + curveAaVars.asset2],
		reserve_asset,
		reserve_asset_decimals: reserve_asset == 'base' ? 9 : registryVars['decimals_' + reserve_asset],
		reserve_asset_symbol: reserve_asset == 'base' ? 'GB' : registryVars['a2s_' + reserve_asset]
	}
	watchGovernanceAa(curveAaVars.governance_aa, curveAaAddress);
	console.log(assocCurveAas[curveAaAddress]);
}

function handleJustsaying(ws, subject, body) {
	switch (subject) {
		case 'light/aa_response':
		//		onAAResponse(body);
			break;
		case 'light/aa_request':
		//	onAARequest(body);
			break;
		case 'light/aa_definition':
				onAADefinition(body);
			break;
	}
}

eventBus.on("message_for_light", handleJustsaying);

function onAADefinition(objUnit){

	for (var i=0; i<objUnit.messages.length; i++){
		var message = objUnit.messages[i];
		var payload = message.payload;
		if (message.app === 'definition' && payload.definition[1].base_aa){
				const base_aa = payload.definition[1].base_aa;
				if (base_aa == conf.deposit_base_aa)
					watchDepositsAa({ address: objectHash.getChash160(payload.definition), definition: payload.definition });
				if (base_aa == conf.curve_base_aa){
					const address = objectHash.getChash160(payload.definition);
					const definition = payload.definition;
					watchCurveAa({ address, definition });
					announcements.announceNewCurve(address, definition);
				}
		}
	}
}




function getStateVarsForPrefixes(aa_address, arrPrefixes){
	return new Promise(function(resolve){
		Promise.all(arrPrefixes.map((prefix)=>{
			return getStateVarsForPrefix(aa_address, prefix)
		})).then((arrResults)=>{
			return resolve(Object.assign({}, ...arrResults));
		}).catch((error)=>{
			return resolve({});
		});
	});
}

function getStateVarsForPrefix(aa_address, prefix, start = '0', end = 'z', firstCall = true){
	return new Promise(function(resolve, reject){
		if (firstCall)
			prefix = prefix.slice(0, -1);
		const CHUNK_SIZE = 2000; // server wouldn't accept higher chunk size

		if (start === end)
			return getStateVarsForPrefix(aa_address, prefix + start,  '0', 'z').then(resolve).catch(reject); // we append prefix to split further

		network.requestFromLightVendor('light/get_aa_state_vars', {
			address: aa_address,
			var_prefix_from: prefix + start,
			var_prefix_to: prefix + end,
			limit: CHUNK_SIZE
		}, function(ws, request, objResponse){
			if (objResponse.error)
				return reject(objResponse.error);

			if (Object.keys(objResponse).length >= CHUNK_SIZE){ // we reached the limit, let's split in two ranges and try again
				const delimiter =  Math.floor((end.charCodeAt(0) - start.charCodeAt(0)) / 2 + start.charCodeAt(0));
				Promise.all([
					getStateVarsForPrefix(aa_address, prefix, start, String.fromCharCode(delimiter), false),
					getStateVarsForPrefix(aa_address, prefix, String.fromCharCode(delimiter +1), end, false)
				]).then(function(results){
					return resolve({...results[0], ...results[1]});
				}).catch(function(error){
					return reject(error);
				})
			} else{
				return resolve(objResponse);
			}

		});
	});
}


function getStateVars(aa_address){
	return new Promise((resolve)=>{
		network.requestFromLightVendor('light/get_aa_state_vars', {
			address: aa_address
		}, function(ws, request, objResponse){
			if (objResponse.error){
				console.log("Error when requesting state vars for " + aa_address + ": " + objResponse.error);
				resolve({});
			} else
				resolve(objResponse);
		});
	});
}
process.on('unhandledRejection', up => { throw up });