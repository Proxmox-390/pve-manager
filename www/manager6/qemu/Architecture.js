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
        // s390x VMs of mainframe operating systems, see getBusCategory()
        's390x-dasd': ['fba', 'ckd', 'unused'],
    },

    // The category of PVE.qemu.Architecture.allowedBusses for new disks of a VM: its
    // architecture, but mainframe operating systems (s390x, not Linux) only get DASDs.
    getBusCategory: function (arch, ostype) {
        if (arch === 's390x' && !PVE.qemu.Architecture.isS390xLinux(ostype)) {
            return 's390x-dasd';
        }
        return arch;
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
    // serial terminal interfaces, from the VM config, the one of the operating system first. By
    // OS type, Linux uses the VT220 SCLP console. Other (mainframe) OSes use one of the 3270
    // terminals as system console, so these come first, named and ordered by their device
    // number, followed by the line-mode SCLP console and the integrated (SCLP) 3270 console. The
    // 3270 ones have the 3270 model they emulate as 'model'.
    getS390xConsoles: function (conf) {
        let terminals = [];
        for (let i = 0; i < PVE.Utils.hardware_counts.terminal; i++) {
            let key = `terminal${i}`;
            if (conf[key]) {
                let terminal = PVE.Parser.parsePropertyString(conf[key], 'devno');
                let [ssid, number] = PVE.qemu.Architecture.splitCcwDevno(terminal.devno ?? '');
                terminals.push({
                    serial: key,
                    text: number !== undefined ? `3270 0.${ssid}.${number}` : `3270 ${key}`,
                    model: terminal.model ?? '2',
                    order: number !== undefined ? parseInt(ssid + number, 16) : Infinity,
                });
            }
        }
        terminals.sort((a, b) => a.order - b.order);
        terminals = terminals.map(({ serial, text, model }) => ({ serial, text, model }));

        if (PVE.qemu.Architecture.isS390xLinux(conf.ostype)) {
            return [{ serial: 'sclp', text: 'xterm.js' }, ...terminals];
        }
        return [
            ...terminals,
            { serial: 'sclplm', text: gettext('SCLP line mode') },
            // qemu-server always emulates a model 2 for it
            { serial: '3270', text: gettext('SCLP 3270 console'), model: '2' },
        ];
    },

    // The models of 3270 terminals (s390x), with their screen sizes. qemu-server emulates a
    // model 2 for terminals without one.
    terminalModels: [
        ['2', gettext('Model 2 (24x80)')],
        ['3', gettext('Model 3 (32x80)')],
        ['4', gettext('Model 4 (43x80)')],
        ['5', gettext('Model 5 (27x132)')],
    ],

    defaultTerminalModel: '2',

    renderTerminalModel: function (model) {
        model = model ?? PVE.qemu.Architecture.defaultTerminalModel;
        let entry = PVE.qemu.Architecture.terminalModels.find(([key]) => key === model);
        return entry ? entry[1] : `${gettext('Model')} ${model}`;
    },

    // Split a CCW device number (0.<ssid>.<devno> or <devno>) into the subchannel set and the
    // 4-digit device number, both lower-case hex; [] if it is none.
    splitCcwDevno: function (devno) {
        let match = /^(?:[0-9a-f]{1,2}\.([0-3])\.)?([0-9a-f]{1,4})$/i.exec(devno ?? '');
        if (!match) {
            return [];
        }
        return [match[1] ?? '0', match[2].toLowerCase().padStart(4, '0')];
    },

    // On s390x, the machine class decides which devices a VM can have (CD/DVD drives only on the
    // virtio machine), the OS type picks the defaults: Linux guests get virtio-ccw devices and
    // the firmware boot order, other (mainframe) OSes, also when unset, the mainframe devices and
    // IPL settings. OS-type rules on top: mainframe OSes get DASDs as disks only, no cloud-init
    // drive and no VirtIO devices (see hasS390xVirtioDrivers()).
    isS390xLinux: function (ostype) {
        return ostype === 'l24' || ostype === 'l26';
    },

    // An OS-type rule: only Linux guests have drivers for VirtIO NICs, consoles (serial ports)
    // and the VirtIO RNG; mainframe operating systems do not get them offered.
    hasS390xVirtioDrivers: function (ostype) {
        return PVE.qemu.Architecture.isS390xLinux(ostype);
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

    // An entry of the s390x machine list with the annotations QEMU appends to the description of
    // a machine type parsed: 'alias' (the machine type it is an alias of, e.g. czam of the newest
    // czam-vN), 'deprecated', and the 'description' without them, e.g. 'CZAM hardware mode'.
    parseS390xMachine: function (entry) {
        let description = entry.description ?? '';
        let alias = description.match(/\(alias of ([^)\s]+)\)/)?.[1];
        let deprecated = /\(deprecated\)/.test(description);
        description = description
            .replace(/\s*\((?:alias of [^)]*|default|deprecated|secure)\)/g, '')
            .trim();
        if (description === entry.id) {
            description = ''; // qemu-server's fallback for none
        }
        return { ...entry, description, alias, deprecated };
    },

    // The mainframe class machine types to offer for selection, from a loaded machine list, with
    // their 'text': an alias for the newest version of a machine type (e.g. czam) instead of its
    // versions (czam-v1, czam-v2), no deprecated ones. Each machine type has its own description
    // and class, there can be several mainframe class ones.
    getS390xMainframeChoices: function (list) {
        let machines = list
            .filter((m) => m.class === 'mainframe')
            .map((m) => PVE.qemu.Architecture.parseS390xMachine(m));
        let aliases = machines.filter((m) => m.alias).map((m) => m.id);
        return machines
            .filter((m) => !m.deprecated && !aliases.some((alias) => m.id.startsWith(`${alias}-`)))
            .map((m) => ({ ...m, text: PVE.qemu.Architecture.renderS390xMachine(m) }));
    },

    // "czam (CZAM hardware mode)"
    renderS390xMachine: function (machine) {
        return machine.description ? `${machine.id} (${machine.description})` : machine.id;
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
