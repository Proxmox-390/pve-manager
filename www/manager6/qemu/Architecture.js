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
    // serial terminal interfaces, from the VM config, the one of the operating system first. By
    // OS type, Linux uses the VT220 SCLP console. Other (mainframe) OSes use one of the 3270
    // terminals as system console, so these come first, named and ordered by their device
    // number, followed by the line-mode SCLP console and the integrated (SCLP) 3270 console.
    getS390xConsoles: function (conf) {
        let terminals = [];
        for (let i = 0; i < PVE.Utils.hardware_counts.terminal; i++) {
            let key = `terminal${i}`;
            if (conf[key]) {
                let devno = PVE.Parser.parsePropertyString(conf[key], 'devno').devno ?? '';
                let [ssid, number] = PVE.qemu.Architecture.splitCcwDevno(devno);
                terminals.push({
                    serial: key,
                    text: number !== undefined ? `3270 0.${ssid}.${number}` : `3270 ${key}`,
                    order: number !== undefined ? parseInt(ssid + number, 16) : Infinity,
                });
            }
        }
        terminals.sort((a, b) => a.order - b.order);
        terminals = terminals.map(({ serial, text }) => ({ serial, text }));

        if (PVE.qemu.Architecture.isS390xLinux(conf.ostype)) {
            return [{ serial: 'sclp', text: 'xterm.js' }, ...terminals];
        }
        return [
            ...terminals,
            { serial: 'sclplm', text: gettext('SCLP line mode') },
            { serial: '3270', text: gettext('SCLP 3270 console') },
        ];
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

    // On s390x, the OS type selects the devices: Linux guests use virtio-ccw devices and the
    // firmware boot order, other (mainframe) OSes, also when unset, the mainframe devices and IPL
    // settings.
    isS390xLinux: function (ostype) {
        return ostype === 'l24' || ostype === 'l26';
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
