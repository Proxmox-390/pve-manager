/* This file defines the helpers, defaults and limits for various vCPU architectures, such
 * as x86_64, aarch64 and s390x.
 *
 * To add a new architecture, add the respective entry in the defaults/renderers and selection.
 */
Ext.define('PVE.qemu.Architecture', {
    singleton: true,

    selection: [
        ['__default__', `${Proxmox.Utils.defaultText} (${gettext('Host Architecture')})`],
        ['x86_64', gettext('x86 (64-bit)')],
        ['aarch64', gettext('ARM (64-bit)')],
    ],

    // filter for PVE.Utils.kvm_ostypes
    kvmOSTypes: {
        x86_64: {
            bases: undefined, // include all
            ostypes: undefined, // include all
        },
        aarch64: {
            bases: ['Linux', 'Other'],
            ostypes: ['l26', 'other'],
        },
        s390x: {
            bases: ['Linux', 'Other'],
            ostypes: ['l26', 'other'],
        },
    },

    defaultProcessorModel: {
        x86_64: 'x86-64-v2-AES',
        aarch64: 'host',
        s390x: 'host',
    },

    defaultMachines: {
        x86_64: 'pc',
        aarch64: 'virt',
        s390x: 's390-ccw-virtio',
    },

    defaultCDDrive: {
        x86_64: ['ide', 2],
        aarch64: ['scsi', 2],
        s390x: ['scsi', 2],
    },

    allowedScsiHw: {
        x86_64: [
            '__default__',
            'lsi',
            'lsi53c810',
            'megasas',
            'virtio-scsi-pci',
            'virtio-scsi-single',
            'pvscsi',
        ],
        aarch64: ['virtio-scsi-pci', 'virtio-scsi-single'],
        s390x: ['virtio-scsi-pci', 'virtio-scsi-single'], // used as virtio-scsi-ccw
    },

    allowedMachines: {
        x86_64: ['__default__', 'q35'], // __default__ is i440fx
        aarch64: ['__default__'], // __default__ is virt
        s390x: ['__default__'], // __default__ is s390-ccw-virtio
    },

    allowedBusses: {
        x86_64: ['ide', 'sata', 'virtio', 'scsi', 'unused'],
        aarch64: ['sata', 'virtio', 'scsi', 'unused'],
        s390x: ['virtio', 'scsi', 'fba', 'ckd', 'unused'], // fba/ckd: DASDs
    },

    allowedFirmware: {
        x86_64: ['__default__', 'seabios', 'ovmf'], // default is seabios
        aarch64: ['ovmf'],
        s390x: ['__default__'], // the s390-ccw firmware
    },

    allowedTPMVersions: {
        x86_64: ['v1.2', 'v2.0'],
        aarch64: ['v2.0'],
        s390x: [], // no TPM
    },

    render_vcpu_architecture: function (value) {
        switch (value ?? '') {
            case '':
            case 'x86_64':
                return gettext('x86 (64-bit)');
            case 'aarch64':
                return gettext('ARM (64-bit)');
            case 's390x':
                return gettext('IBM Z (64-bit)');
            default:
                return Proxmox.Utils.unknownText;
        }
    },

    // The consoles qemu-server attaches to an s390x VM, which has no VGA display, as xterm.js
    // serial terminal interfaces, from the VM config: by OS type, Linux uses the VT220 SCLP
    // console, other (mainframe) OSes the line-mode SCLP console and the integrated 3270 console.
    // The configured 3270 terminals follow, named by their device number.
    getS390xConsoles: function (conf) {
        let consoles;
        if (PVE.qemu.Architecture.isS390xLinux(conf.ostype)) {
            consoles = [{ serial: 'sclp', text: 'xterm.js' }];
        } else {
            consoles = [
                { serial: 'sclplm', text: 'SCLP' },
                { serial: '3270', text: gettext('3270 Console') },
            ];
        }
        for (let i = 0; i < PVE.Utils.hardware_counts.terminal; i++) {
            let key = `terminal${i}`;
            if (conf[key]) {
                let terminal = PVE.Parser.parsePropertyString(conf[key], 'devno');
                consoles.push({ serial: key, text: `3270 ${terminal.devno ?? key}` });
            }
        }
        return consoles;
    },

    // On s390x, the OS type selects the devices: Linux guests use virtio-ccw devices and the
    // firmware boot order, other (mainframe) OSes, also when unset, the mainframe devices and IPL
    // settings.
    isS390xLinux: function (ostype) {
        return ostype === 'l24' || ostype === 'l26';
    },

    // The s390x machine types of a node, from the machine type API: the versions of the virtio
    // machine (s390-ccw-virtio, class 'virtio': firmware boot, CD-ROM drives) and the unversioned
    // machine types of the QEMU build (class 'mainframe': channel-program IPL, no CD-ROM drives),
    // with the one new VMs get marked 'new-vm-default'. Loaded once per node.
    s390xMachines: {},

    loadS390xMachines: function (nodename, callback) {
        let cache = PVE.qemu.Architecture.s390xMachines;
        nodename = nodename || 'localhost';
        if (cache[nodename]?.loaded) {
            callback(cache[nodename].list);
            return;
        }
        if (cache[nodename]) {
            cache[nodename].callbacks.push(callback);
            return;
        }
        cache[nodename] = { callbacks: [callback] };
        Proxmox.Utils.API2Request({
            url: `/nodes/${nodename}/capabilities/qemu/machines`,
            params: { arch: 's390x' },
            method: 'GET',
            success: function (response) {
                let list = response.result.data ?? [];
                let callbacks = cache[nodename].callbacks;
                cache[nodename] = { loaded: true, list };
                callbacks.forEach((cb) => cb(list));
            },
            failure: function () {
                let callbacks = cache[nodename].callbacks;
                delete cache[nodename];
                callbacks.forEach((cb) => cb([]));
            },
        });
    },

    // The machine type a new s390x VM gets, from a loaded machine list.
    getS390xNewVmMachine: function (list) {
        let entry = list.find((machine) => machine['new-vm-default']);
        return entry?.id ?? PVE.qemu.Architecture.defaultMachines.s390x;
    },

    // The class of an s390x machine config value, 'virtio' or 'mainframe', as qemu-server
    // classifies it (see the machine type API): unset is the virtio machine.
    getS390xMachineClass: function (machine, list) {
        let type = PVE.Parser.parsePropertyString(machine ?? '', 'type').type;
        if (!type || type === '__default__') {
            return 'virtio';
        }
        let entry = (list ?? []).find((m) => m.id === type);
        if (entry?.class) {
            return entry.class;
        }
        return type.match(/^s390-ccw-virtio(?:$|-)/) ? 'virtio' : 'mainframe';
    },

    getNodeArchitecture: function (nodename) {
        let hostArch = PVE.data.ResourceStore.getNodeById(nodename)?.data['host-arch'];
        return PVE.qemu.Architecture.normalizeArchitecture(hostArch) ?? 'x86_64';
    },

    normalizeArchitecture: function (architecture) {
        if (!architecture?.length || architecture === '__default__') {
            return undefined;
        }
        return architecture;
    },
    // returns the resulting architecture from a given arch and
    // the nodename, in case the architecture is set to default or empty
    getGuestArchitecture: function (architecture, nodename) {
        let hostArch = PVE.qemu.Architecture.getNodeArchitecture(nodename);
        return PVE.qemu.Architecture.normalizeArchitecture(architecture) ?? hostArch;
    },

    // returns if the given architecture is the native host architecture of the given nodename
    isHostArchitecture: function (architecture, nodename) {
        architecture = PVE.qemu.Architecture.normalizeArchitecture(architecture);
        let hostArch = PVE.qemu.Architecture.getNodeArchitecture(nodename);
        return (architecture ?? hostArch) === hostArch;
    },
});
