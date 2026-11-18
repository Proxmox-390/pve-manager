Ext.define('PVE.qemu.SystemInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    xtype: 'pveQemuSystemPanel',

    onlineHelp: 'qm_system_settings',

    viewModel: {
        data: {
            efi: false,
            addefi: true,
        },

        formulas: {
            efidisk: function (get) {
                return get('efi') && get('addefi');
            },
            // s390x VMs get 3270 terminals instead of a display
            isS390x: (get) => get('current.architecture') === 's390x',
        },
    },

    onGetValues: function (values) {
        if (values.vga && values.vga.substr(0, 6) === 'serial') {
            values['serial' + values.vga.substr(6, 1)] = 'socket';
        }

        delete values.hdimage;
        delete values.hdstorage;
        delete values.diskformat;

        delete values.preEnrolledKeys; // efidisk
        delete values.version; // tpmstate

        // s390x: 3270 terminals at consecutive device numbers
        let count = values.terminals ?? 0;
        let match = /^(?:0\.([0-3])\.)?([0-9a-f]{1,4})$/i.exec(values.terminaldevno ?? '');
        if (match) {
            let [, ssid = '0', first] = match;
            for (let i = 0; i < count; i++) {
                let devno = (parseInt(first, 16) + i).toString(16).padStart(4, '0');
                values[`terminal${i}`] = `0.${ssid}.${devno}`;
            }
        }
        delete values.terminals;
        delete values.terminaldevno;

        return values;
    },

    controller: {
        xclass: 'Ext.app.ViewController',

        scsihwChange: function (field, value) {
            var me = this;
            if (me.getView().insideWizard) {
                me.getViewModel().set('current.scsihw', value);
            }
        },

        biosChange: function (field, value) {
            var me = this;
            if (me.getView().insideWizard) {
                me.getViewModel().set('efi', value === 'ovmf');
            }
        },

        control: {
            pveScsiHwSelector: {
                change: 'scsihwChange',
            },
            pveQemuBiosSelector: {
                change: 'biosChange',
            },
            '#': {
                afterrender: 'setDefaults',
            },
        },

        setDefaults: function () {
            let me = this;
            let vm = this.getViewModel();

            let ostype = vm.get('current.ostype');
            let architecture = vm.get('current.architecture');

            let defaults = PVE.qemu.OSDefaults.getDefaults(ostype, architecture);
            if (ostype === 'win11') {
                me.lookup('addtpmbox').setValue(true);
            }

            me.lookup('vga').setValue(defaults.vga ?? '__default__');
            // mainframe operating systems need a 3270 terminal, Linux has its SCLP console
            let terminals = architecture === 's390x' && !PVE.qemu.Architecture.isS390xLinux(ostype);
            me.lookup('terminals').setValue(terminals ? 1 : 0);
            me.lookup('machine').setValue(defaults.machine ?? '__default__');
            me.lookup('bios').setValue(defaults.bios ?? '__default__');
        },
    },

    column1: [
        {
            xtype: 'proxmoxKVComboBox',
            value: '__default__',
            deleteEmpty: false,
            fieldLabel: gettext('Graphic card'),
            name: 'vga',
            reference: 'vga',
            comboItems: Object.entries(PVE.Utils.kvm_vga_drivers),
        },
        {
            xtype: 'proxmoxintegerfield',
            name: 'terminals',
            reference: 'terminals',
            fieldLabel: gettext('3270 Terminals'),
            minValue: 0,
            maxValue: PVE.Utils.hardware_counts.terminal,
            value: 0,
            hidden: true,
            disabled: true,
            bind: {
                hidden: '{!isS390x}',
                disabled: '{!isS390x}',
            },
        },
        {
            xtype: 'pveCcwDevnoField',
            name: 'terminaldevno',
            fieldLabel: gettext('First Address'),
            kind: '3270',
            autoSuggest: false, // a new VM, the 3270 range starts there
            value: '0.0.0700',
            hidden: true,
            disabled: true,
            bind: {
                hidden: '{!isS390x}',
                disabled: '{!isS390x}',
            },
        },
        {
            xtype: 'pveQemuMachineSelector',
            name: 'machine',
            reference: 'machine',
            value: '__default__',
            fieldLabel: gettext('Machine'),
            bind: {
                category: '{current.architecture}',
            },
        },
        {
            xtype: 'displayfield',
            value: gettext('Firmware'),
        },
        {
            xtype: 'pveQemuBiosSelector',
            name: 'bios',
            reference: 'bios',
            value: '__default__',
            fieldLabel: 'BIOS',
            bind: {
                category: '{current.architecture}',
            },
        },
        {
            xtype: 'proxmoxcheckbox',
            bind: {
                value: '{addefi}',
                hidden: '{!efi}',
                disabled: '{!efi}',
            },
            hidden: true,
            submitValue: false,
            disabled: true,
            fieldLabel: gettext('Add EFI Disk'),
        },
        {
            xtype: 'pveEFIDiskInputPanel',
            name: 'efidisk0',
            storageContent: 'images',
            bind: {
                nodename: '{nodename}',
                hidden: '{!efi}',
                disabled: '{!efidisk}',
            },
            autoSelect: false,
            disabled: true,
            hidden: true,
            hideSize: true,
            usesEFI: true,
            insideWizard: true,
        },
    ],

    column2: [
        {
            xtype: 'pveScsiHwSelector',
            name: 'scsihw',
            value: '__default__',
            bind: {
                category: '{current.architecture}',
                value: '{current.scsihw}',
            },
            fieldLabel: gettext('SCSI Controller'),
        },
        {
            xtype: 'proxmoxcheckbox',
            name: 'agent',
            uncheckedValue: 0,
            defaultValue: 0,
            deleteDefaultValue: true,
            fieldLabel: gettext('Qemu Agent'),
        },
        {
            // fake for spacing
            xtype: 'displayfield',
            value: ' ',
        },
        {
            xtype: 'proxmoxcheckbox',
            reference: 'addtpmbox',
            bind: {
                value: '{addtpm}',
            },
            submitValue: false,
            fieldLabel: gettext('Add TPM'),
        },
        {
            xtype: 'pveTPMDiskInputPanel',
            name: 'tpmstate0',
            storageContent: 'images',
            bind: {
                nodename: '{nodename}',
                arch: '{current.architecture}',
                hidden: '{!addtpm}',
                disabled: '{!addtpm}',
            },
            disabled: true,
            hidden: true,
            insideWizard: true,
        },
    ],
});
