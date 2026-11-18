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
            // s390x has no graphic card, SCSI controller choice (always virtio), BIOS or TPM
            isS390x: function (get) {
                return get('current.architecture') === 's390x';
            },
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

        machineChange: function (field, value) {
            var me = this;
            if (me.getView().insideWizard) {
                me.getViewModel().set('current.machine', value);
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
            pveQemuMachineSelector: {
                change: 'machineChange',
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

            if (architecture === 's390x') {
                return; // the machine selector selects the default for new VMs itself
            }
            me.lookup('vga').setValue(defaults.vga ?? '__default__');
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
            bind: {
                hidden: '{isS390x}',
                disabled: '{isS390x}',
            },
        },
        {
            xtype: 'pveQemuMachineSelector',
            name: 'machine',
            reference: 'machine',
            value: '__default__',
            fieldLabel: gettext('Machine'),
            selectNewVmDefault: true,
            bind: {
                category: '{current.architecture}',
                nodename: '{nodename}',
            },
        },
        {
            xtype: 'displayfield',
            value: gettext('Firmware'),
            bind: {
                hidden: '{isS390x}',
            },
        },
        {
            xtype: 'pveQemuBiosSelector',
            name: 'bios',
            reference: 'bios',
            value: '__default__',
            fieldLabel: 'BIOS',
            bind: {
                category: '{current.architecture}',
                hidden: '{isS390x}',
                disabled: '{isS390x}',
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
                hidden: '{isS390x}',
                disabled: '{isS390x}',
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
                hidden: '{isS390x}',
                disabled: '{isS390x}',
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
