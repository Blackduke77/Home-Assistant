const fz = require('zigbee-herdsman-converters/converters/fromZigbee');
const tz = require('zigbee-herdsman-converters/converters/toZigbee');
const exposes = require('zigbee-herdsman-converters/lib/exposes');
const reporting = require('zigbee-herdsman-converters/lib/reporting');
const ota = require('zigbee-herdsman-converters/lib/ota');
const e = exposes.presets;
const ea = exposes.access;
const utils = require('zigbee-herdsman-converters/lib/utils');

// Custom fromZigbee converter for brightness to handle global brightness
const fzBrightness = {
    cluster: 'genLevelCtrl',
    type: ['attributeReport', 'readResponse'],
    convert: (model, msg, publish, options, meta) => {
        const brightness = msg.data['currentLevel'];
        return { brightness: brightness !== undefined ? brightness : null };  // Ensure brightness is reported globally
    },
};

// Custom fromZigbee converter for child lock
const fzChildLock = {
    cluster: 'genBasic',
    type: ['attributeReport', 'readResponse'],
    convert: (model, msg, publish, options, meta) => {
        const endpoint = msg.endpoint.ID;
        const childLockState = msg.data['deviceEnabled'] === 1 ? 'UNLOCKED' : 'LOCKED';
        if (endpoint === 1) {
            return { socket_left_child_lock: childLockState };
        } else if (endpoint === 2) {
            return { socket_right_child_lock: childLockState };
        }
    },
};

// Custom toZigbee converter for child lock (with manual refresh support)
const tzChildLock = {
    key: ['socket_left_child_lock', 'socket_right_child_lock'],
    convertSet: async (entity, key, value, meta) => {
        const childLock = value.toLowerCase() === 'locked' ? 0 : 1;
        const endpointId = (key === 'socket_left_child_lock') ? 1 : 2;
        const device = meta.device;
        const endpoint = device.endpoints.find(e => e.ID === endpointId);

        if (!endpoint) {
            console.error(`Endpoint ${endpointId} not found`);
            return;
        }

        try {
            await endpoint.write('genBasic', { deviceEnabled: childLock });
        } catch (error) {
            console.error(`Error setting child lock on endpoint ${endpointId}: ${error}`);
        }
        return { state: { [key]: value.toUpperCase() } };
    },
    convertGet: async (entity, key, meta) => {
        const endpointId = (key === 'socket_left_child_lock') ? 1 : 2;
        const endpoint = entity.getDevice().getEndpoint(endpointId);

        try {
            const result = await endpoint.read('genBasic', ['deviceEnabled']);
            const childLockState = result['deviceEnabled'] === 1 ? 'UNLOCKED' : 'LOCKED';
            return { [key]: childLockState };
        } catch (error) {
            console.error(`Error reading child lock state from endpoint ${endpointId}: ${error}`);
        }
    },
};

// Custom toZigbee converter for backlight brightness
const tzLocal = {
    backlight_brightness: {
        key: ['brightness'],
        options: [exposes.options.transition()],
        convertSet: async (entity, key, value, meta) => {
            await entity.command('genLevelCtrl', 'moveToLevel', { level: value, transtime: 0 }, utils.getOptions(meta.mapped, entity));
            return { state: { brightness: value } };
        },
        convertGet: async (entity, key, meta) => {
            try {
                const endpoint = entity.getDevice().getEndpoint(1);
                const result = await endpoint.read('genLevelCtrl', ['currentLevel']);
                return { brightness: result['currentLevel'] };
            } catch (error) {
                console.error(`Error reading brightness: ${error}`);
                throw error;
            }
        },
    },
};

// Device definition for the Double Socket device
const definition = {
    zigbeeModel: ['DoubleSocket50AU'],
    model: 'AU-A1ZBDSS',
    vendor: 'Aurora Lighting',
    description: 'Double smart socket UK',
    fromZigbee: [fz.identify, fz.on_off, fz.electrical_measurement, fzChildLock, fzBrightness],
    toZigbee: [tz.on_off, tzChildLock, tzLocal.backlight_brightness],
    exposes: [
        e.switch().withEndpoint('left'),
        e.switch().withEndpoint('right'),
        e.power().withEndpoint('left'),
        e.power().withEndpoint('right'),
        e.numeric('brightness', ea.ALL)
            .withValueMin(0).withValueMax(254)
            .withDescription('Brightness of the backlight LED'),
        e.binary('socket_left_child_lock', ea.STATE_SET | ea.STATE_GET, 'LOCKED', 'UNLOCKED')
            .withDescription('Child lock status for left socket'),
        e.binary('socket_right_child_lock', ea.STATE_SET | ea.STATE_GET, 'LOCKED', 'UNLOCKED')
            .withDescription('Child lock status for right socket')
    ],
    meta: { multiEndpoint: true },
    ota: ota.zigbeeOTA,

    // Map the device's endpoints
    endpoint: (device) => {
        return { 'left': 1, 'right': 2 };
    },

	// Device configuration to set up reporting and initial read
	configure: async (device, coordinatorEndpoint) => {
		const endpoint1 = device.getEndpoint(1);
		const endpoint2 = device.getEndpoint(2);

		// Bind necessary clusters for both endpoints
		await reporting.bind(endpoint1, coordinatorEndpoint, ['genIdentify', 'genOnOff', 'haElectricalMeasurement', 'genBasic']);
		await reporting.bind(endpoint2, coordinatorEndpoint, ['genIdentify', 'genOnOff', 'haElectricalMeasurement', 'genBasic']);

		// Configure On/Off state reporting
		await reporting.onOff(endpoint1, { min: 60, max: 600, change: 1 });
		await reporting.onOff(endpoint2, { min: 60, max: 600, change: 1 });

		// Configure power monitoring reporting to reduce chatter (for endpoint1)
		await reporting.activePower(endpoint1, { min: 60, max: 600, change: 10 });  // Report every 1-10 minutes or if power changes by 10 watts

		// Configure power monitoring reporting to reduce chatter (for endpoint2)
		await reporting.activePower(endpoint2, { min: 60, max: 600, change: 10 });


		// Set default brightness for endpoint 1
		try {
			const defaultBrightness = 30;
			await endpoint1.command('genLevelCtrl', 'moveToLevel', { level: defaultBrightness, transtime: 0 });
		} catch (error) {
			console.error('Failed to set default brightness on endpoint 1:', error);
		}

		// Ensure the device is ready for initial reads
		await new Promise(resolve => setTimeout(resolve, 2000)); // 1-second delay to ensure configuration is complete

		// Force initial state read after configuration to synchronize states
		try {
			const stateLeft = await endpoint1.read('genOnOff', ['onOff']);
			const stateRight = await endpoint2.read('genOnOff', ['onOff']);
			const brightness = await endpoint1.read('genLevelCtrl', ['currentLevel']);
			const childLockLeft = await endpoint1.read('genBasic', ['deviceEnabled']);
			const childLockRight = await endpoint2.read('genBasic', ['deviceEnabled']);

			// Publish the initial state to MQTT
			device.publish('state_left', { state: stateLeft.onOff ? 'ON' : 'OFF' });
			device.publish('state_right', { state: stateRight.onOff ? 'ON' : 'OFF' });
			device.publish('brightness', { brightness: brightness.currentLevel });
			device.publish('socket_left_child_lock', { state: childLockLeft.deviceEnabled === 1 ? 'UNLOCKED' : 'LOCKED' });
			device.publish('socket_right_child_lock', { state: childLockRight.deviceEnabled === 1 ? 'UNLOCKED' : 'LOCKED' });
		} catch (error) {
			console.error('Failed to read state or brightness after configuration:', error);
		}
	}

};

module.exports = definition;
