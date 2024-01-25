const fz = require('zigbee-herdsman-converters/converters/fromZigbee');
const tz = require('zigbee-herdsman-converters/converters/toZigbee');
const exposes = require('zigbee-herdsman-converters/lib/exposes');
const reporting = require('zigbee-herdsman-converters/lib/reporting');
const ota = require('zigbee-herdsman-converters/lib/ota');
const e = exposes.presets;
const ea = exposes.access;
const utils = require('zigbee-herdsman-converters/lib/utils');

// Custom fromZigbee converter for child lock
const fzChildLock = {
    cluster: 'genBasic',
    type: ['attributeReport', 'readResponse'],
    convert: (model, msg, publish, options, meta) => {
        const endpoint = msg.endpoint.ID;
        const childLockState = msg.data['deviceEnabled'] === 1 ? 'UNLOCKED' : 'LOCKED'; // Inverted logic here
        if (endpoint === 1) {
            return { socket_left_child_lock: childLockState };
        } else if (endpoint === 2) {
            return { socket_right_child_lock: childLockState };
        }
    },
};

// Custom toZigbee converter for child lock
const tzChildLock = {
    key: ['socket_left_child_lock', 'socket_right_child_lock'],
    convertSet: async (entity, key, value, meta) => {
        const childLock = value.toLowerCase() === 'locked' ? 0 : 1; // Inverted logic here
        const endpointId = (key === 'socket_left_child_lock') ? 1 : 2;
        const device = meta.device;
        const endpoint = device.endpoints.find(e => e.ID === endpointId);

        if (!endpoint) {
            console.error(`Endpoint ${endpointId} not found`);
            return;
        }

        try {
            await endpoint.write('genBasic', { deviceEnabled: childLock });
            console.log(`Child lock set on endpoint ${endpointId} to ${value}`);
        } catch (error) {
            console.error(`Error setting child lock on endpoint ${endpointId}: ${error}`);
        }
        return { state: { [key]: value.toUpperCase() } };
    },
};

// Custom toZigbee converter for backlight brightness
const tzLocal = {
    backlight_brightness: {
        key: ['brightness'],
        options: [exposes.options.transition()],
        convertSet: async (entity, key, value, meta) => {
            await entity.command('genLevelCtrl', 'moveToLevel', {level: value, transtime: 0}, utils.getOptions(meta.mapped, entity));
            return {state: {brightness: value}};
        },
        convertGet: async (entity, key, meta) => {
            await entity.read('genLevelCtrl', ['currentLevel']);
        },
    },
};

// Device definition
const definition = {
    zigbeeModel: ['DoubleSocket50AU'],
    model: 'AU-A1ZBDSS',
    vendor: 'Aurora Lighting',
    description: 'Double smart socket UK with child lock',
    fromZigbee: [fz.identify, fz.on_off, fz.electrical_measurement, fzChildLock, fz.brightness],
    toZigbee: [tz.on_off, tzChildLock, tzLocal.backlight_brightness],
    exposes: [
        e.switch().withEndpoint('left'), e.switch().withEndpoint('right'),
        e.power().withEndpoint('left'), e.power().withEndpoint('right'),
        e.numeric('brightness', ea.ALL).withValueMin(0).withValueMax(254)
            .withDescription('Brightness of this backlight LED'),
        e.binary('socket_left_child_lock', ea.SET, 'LOCKED', 'UNLOCKED').withDescription('Child lock status for left socket'),
        e.binary('socket_right_child_lock', ea.SET, 'LOCKED', 'UNLOCKED').withDescription('Child lock status for right socket')
    ],
    meta: { multiEndpoint: true },
    ota: ota.zigbeeOTA,
    endpoint: (device) => {
        return {'left': 1, 'right': 2};
    },
    configure: async (device, coordinatorEndpoint, logger) => {
        const endpoint1 = device.getEndpoint(1);
        await reporting.bind(endpoint1, coordinatorEndpoint, ['genIdentify', 'genOnOff', 'haElectricalMeasurement']);
        await reporting.onOff(endpoint1);
        const endpoint2 = device.getEndpoint(2);
        await reporting.bind(endpoint2, coordinatorEndpoint, ['genIdentify', 'genOnOff', 'haElectricalMeasurement']);
        await reporting.onOff(endpoint2);
    },
};

module.exports = definition;
