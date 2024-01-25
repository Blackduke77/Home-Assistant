const fz = require('zigbee-herdsman-converters/converters/fromZigbee');
const tz = require('zigbee-herdsman-converters/converters/toZigbee');
const exposes = require('zigbee-herdsman-converters/lib/exposes');
const reporting = require('zigbee-herdsman-converters/lib/reporting');
const extend = require('zigbee-herdsman-converters/lib/extend');
const e = exposes.presets;
const ea = exposes.access;
const legacy = require('zigbee-herdsman-converters/lib/legacy');

const tuya = require('zigbee-herdsman-converters/lib/tuya');

const dataTypes = {
	raw: 0, // [ bytes ]
	bool: 1, // [0/1]
	number: 2, // [ 4 byte value ]
	string: 3, // [ N byte string ]
	enum: 4, // [ 0-255 ]
	bitmap: 5, // [ 1,2,4 bytes ] as bits
};

const dpMap = {
	dpPresenceState: 112, //是否存在，仅上报
	dpState: 105, //感应状态
	dpMoveSensitivity: 106, //灵敏度
	dpPresenceSensitivity: 111, //灵敏度

	dpTimeout: 110, //感应延迟

	dpDistance: 109, //目标距离


	dpRange: 107, //最远距离范围
	dpIlluminanceLux: 104, //光照度




};
const fzLocal = {
	cluster: 'manuSpecificTuya',
	type: ['commandDataResponse', 'commandDataReport'],
	convert: (model, msg, publish, options, meta) => {
		const dp = msg.data.dpValues[0].dp;
		const data = msg.data;
		const value = legacy.getDataValue(data.dpValues[0]);
		const result = {};

		switch (dp) {
			case dpMap.dpPresenceState:
				result.presence = value ? true : false;
				break;
			case dpMap.dpMoveSensitivity: //Sensitivity
				result.motion_sensitivity = (value / 10);
				break;
			case dpMap.dpPresenceSensitivity: //Resting sensitivity
				result.presence_sensitivity = (value / 10);
				break;
			case dpMap.dpRange: //Radar range 15-55
				result.detection_distance_max = (value / 100);
				break;
			case dpMap.dpDistance: //Target distance
				result.target_distance = (value / 100);
				break;
			case dpMap.dpTimeout: //Delay 0-600
				result.presence_timeout = (value);
				break;
			case dpMap.dpIlluminanceLux: //Light illuminance
				result.illuminance_lux = (value);
				break;

			case dpMap.dpState:
				result.presence_state = {
					0: 'none',
					1: 'Present',
					2: 'Moving'
				} [value];
				break;

				// meta.logger.debug(
				// 	`未解析的数据DP: ${dp} DATA: ${JSON.stringify(msg.data)}`
				// );

		}
		return result;
	},
}
const tzLocal = {
	key: [
		'motion_sensitivity',
		'presence_sensitivity',
		'detection_distance_max',
		'presence_timeout',

	],
	convertSet: async (entity, key, value, meta) => {

		switch (key) {
			case 'motion_sensitivity':
				await legacy.sendDataPointValue(entity, dpMap.dpMoveSensitivity, value);
				break;
			case 'presence_sensitivity':
				await legacy.sendDataPointValue(entity, dpMap.dpPresenceSensitivity, value);
				break;
			case 'detection_distance_max':
				await legacy.sendDataPointValue(entity, dpMap.dpRange, value * 100);
				break;
			case 'presence_timeout':
				await legacy.sendDataPointValue(entity, dpMap.dpTimeout, value);
				break;

		}
		return {
			key: value
		};
	},

}


module.exports = [{
	fingerprint: [{
		modelID: 'TS0601',
		manufacturerName: '_TZE204_ijxvkhd0',
	}],
	model: 'ZY-M100-24G',
	vendor: 'TuYa',
	description: 'Micro Motion Sensor v1.2',
	fromZigbee: [fzLocal],
	toZigbee: [tzLocal],
	onEvent: legacy.onEventSetLocalTime,
	exposes: [

		exposes.enum('presence_state', ea.STATE, ['none', 'Present', 'Moving'])
		.withDescription('Presence state'),

		e.presence().withDescription('Presence detected'),


		exposes.numeric('target_distance', ea.STATE)
		.withDescription('Distance to target'),

		e.illuminance_lux(),
		exposes.numeric('motion_sensitivity', ea.STATE_SET).withValueMin(1)
		.withValueMax(10)
		.withValueStep(1)
		.withDescription('Motion sensitivity'),

		exposes.numeric('presence_sensitivity', ea.STATE_SET).withValueMin(1)
		.withValueMax(10)
		.withValueStep(1)
		.withDescription('Presence sensitivity'),

		exposes.numeric('detection_distance_max', ea.STATE_SET).withValueMin(1.5)
		.withValueMax(5.5)
		.withValueStep(1)
		.withUnit('m').withDescription('Detection distance'),


		exposes.numeric('presence_timeout', ea.STATE_SET).withValueMin(1)
		.withValueMax(600)
		.withValueStep(1)
		.withUnit('s').withDescription('Delay timeout'),



	],
	meta: {
		multiEndpoint: true,
		tuyaDatapoints: [



			[112, 'presence', tuya.valueConverter.trueFalse1],
			[106, 'motion_sensitivity', tuya.valueConverter.divideBy10],
			[111, 'presence_sensitivity', tuya.valueConverter.divideBy10],

			[107, 'detection_distance_max', tuya.valueConverter.divideBy100],
			[109, 'target_distance', tuya.valueConverter.divideBy100],
			[110, 'presence_timeout', tuya.valueConverter.raw],
			[104, 'illuminance_lux', tuya.valueConverter.raw],
			[105, 'presence_state', tuya.valueConverterBasic.lookup({
				'none': 0,
				'Present': 1,
				'Moving': 2
			})],

		],
	},
}, ];