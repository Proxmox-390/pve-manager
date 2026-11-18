// Install media of s390x VMs: tape drives with an AWSTAPE image, and the network boot of an
// installer from an .ins file. CD/DVD drives only exist on the virtio machine.

Ext.define('PVE.qemu.S390xMedia', {
    singleton: true,

    maxTapes: 4,

    isTapeImage: (volid) => !!volid?.match(/\.aws$/i),

    // an .ins (or z/VM exec) URL, which must not contain characters of the property string
    urlRegex: /^https?:\/\/[^\s,;]+$/,

    tapeIdents: [
        ['__default__', `${Proxmox.Utils.defaultText} (3590)`],
        ...[
            '3410',
            '3411',
            '3420',
            '3422',
            '3430',
            '3480',
            '3490',
            '3590',
            '8809',
            '9347',
            '9348',
        ].map((ident) => [ident, ident]),
    ],

    defaultTapeDevno: (key) => {
        let index = parseInt(key.replace(/^tape/, ''), 10) || 0;
        return `0.0.${(0x580 + index).toString(16).padStart(4, '0')}`;
    },

    renderTape: function (value) {
        let tape = PVE.Parser.parsePropertyString(value ?? '', 'file');
        let text = tape.file === 'none' ? gettext('empty') : tape.file;
        if (tape.devno) {
            text += `, devno=${tape.devno}`;
        }
        if (tape.ident) {
            text += `, ident=${tape.ident}`;
        }
        return Ext.htmlEncode(text);
    },

    renderNetboot: function (value) {
        let netboot = PVE.Parser.parsePropertyString(value ?? '', 'url');
        let text = netboot.url ?? '';
        if (!netboot.kernel) {
            text += ` (${gettext('not fetched')})`;
        }
        if (PVE.Parser.parseBoolean(netboot.once, true)) {
            text += ` (${gettext('once')})`;
        }
        return Ext.htmlEncode(text);
    },
});

Ext.define('PVE.qemu.TapeInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    alias: 'widget.pveQemuTapeInputPanel',

    onlineHelp: 'qm_virtual_machines_settings',

    confid: undefined,

    onGetValues: function (values) {
        let me = this;
        let confid = me.confid || values.confid;
        let tape = {
            file: values.mediaType === 'image' ? values.tapeimage : 'none',
        };
        if (values.devno) {
            tape.devno = values.devno;
        }
        if (values.ident && values.ident !== '__default__') {
            tape.ident = values.ident;
        }
        return { [confid]: PVE.Parser.printPropertyString(tape, 'file') };
    },

    setVMConfig: function (vmconfig) {
        let me = this;
        if (me.confid) {
            return;
        }
        let free;
        for (let i = 0; i < PVE.qemu.S390xMedia.maxTapes; i++) {
            if (!vmconfig[`tape${i}`]) {
                free = `tape${i}`;
                break;
            }
        }
        let field = me.down('field[name=confid]');
        if (free) {
            field.setValue(free);
            me.down('field[name=devno]').setEmptyText(PVE.qemu.S390xMedia.defaultTapeDevno(free));
        } else {
            field.markInvalid(gettext('All tape drives are in use'));
        }
    },

    setTape: function (value) {
        let me = this;
        let tape = PVE.Parser.parsePropertyString(value, 'file');
        me.setValues({
            mediaType: tape.file === 'none' ? 'none' : 'image',
            tapeimage: tape.file === 'none' ? undefined : tape.file,
            devno: tape.devno ?? '',
            ident: tape.ident ?? '__default__',
        });
    },

    initComponent: function () {
        let me = this;

        let items = [];
        if (!me.confid) {
            items.push({
                xtype: 'displayfield',
                name: 'confid',
                fieldLabel: gettext('Tape Drive'),
                submitValue: true,
                allowBlank: false,
            });
        }
        items.push(
            {
                xtype: 'radiofield',
                name: 'mediaType',
                inputValue: 'image',
                boxLabel: gettext('Use tape image file (AWSTAPE)'),
                checked: true,
                listeners: {
                    change: function (f, value) {
                        let image = me.down('pveIsoSelector');
                        image.setDisabled(!value);
                        if (value) {
                            image.validate();
                        }
                    },
                },
            },
            {
                xtype: 'pveIsoSelector',
                name: 'tapeimage',
                nodename: me.nodename,
                fileFilter: (rec) => PVE.qemu.S390xMedia.isTapeImage(rec.data.volid),
                fileLabel: gettext('Tape image'),
            },
            {
                xtype: 'radiofield',
                name: 'mediaType',
                inputValue: 'none',
                boxLabel: gettext('Empty drive'),
            },
        );

        me.items = items;
        me.advancedItems = [
            {
                xtype: 'proxmoxtextfield',
                name: 'devno',
                fieldLabel: gettext('Device number'),
                regex: /^(?:0\.[0-3]\.[0-9a-fA-F]{1,4}|[0-9a-fA-F]{3,4})$/,
                regexText: '0.0.0580',
                emptyText: me.confid ? PVE.qemu.S390xMedia.defaultTapeDevno(me.confid) : '',
                deleteEmpty: false,
            },
            {
                xtype: 'proxmoxKVComboBox',
                name: 'ident',
                fieldLabel: gettext('Drive type'),
                value: '__default__',
                deleteEmpty: false,
                comboItems: PVE.qemu.S390xMedia.tapeIdents,
            },
            {
                xtype: 'displayfield',
                userCls: 'pmx-hint',
                value: gettext(
                    'The medium is read-only. It can be changed while the VM runs, the other settings apply at the next start.',
                ),
            },
        ];

        me.callParent();
    },
});

Ext.define('PVE.qemu.TapeEdit', {
    extend: 'Proxmox.window.Edit',

    backgroundDelay: 5,
    width: 450,

    initComponent: function () {
        let me = this;

        let nodename = me.pveSelNode.data.node;
        if (!nodename) {
            throw 'no node name specified';
        }

        me.isCreate = !me.confid;

        let ipanel = Ext.create('PVE.qemu.TapeInputPanel', {
            confid: me.confid,
            nodename,
        });

        Ext.applyIf(me, {
            subject: gettext('Tape Drive'),
            items: [ipanel],
        });

        me.callParent();

        me.load({
            success: function (response) {
                let conf = response.result.data;
                ipanel.setVMConfig(conf);
                if (me.confid && conf[me.confid]) {
                    ipanel.setTape(conf[me.confid]);
                }
            },
        });
    },
});

Ext.define('PVE.qemu.NetbootInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    alias: 'widget.pveQemuNetbootInputPanel',

    onlineHelp: 'qm_virtual_machines_settings',

    isCreate: false,

    onGetValues: function (values) {
        let me = this;
        let current = me.netboot ?? {};
        let refetch = me.isCreate || values.refetch || values.url !== current.url;

        let netboot;
        if (refetch) {
            netboot = { url: values.url, storage: values.storage };
        } else {
            netboot = { ...current };
        }
        if (values.once) {
            delete netboot.once;
        } else {
            netboot.once = 0;
        }

        let res = { netboot: PVE.Parser.printPropertyString(netboot, 'url') };
        let cmdline = me.down('field[name=cmdline]');
        if (!refetch || cmdline.isDirty()) {
            // a fetch sets the command line from the parameter file of the installer
            if (values.cmdline) {
                res['netboot-cmdline'] = values.cmdline;
            } else if (!me.isCreate) {
                res.delete = 'netboot-cmdline';
            }
        }
        return res;
    },

    setNetboot: function (value, cmdline) {
        let me = this;
        me.netboot = PVE.Parser.parsePropertyString(value, 'url');
        me.setValues({
            url: me.netboot.url,
            once: PVE.Parser.parseBoolean(me.netboot.once, true),
            cmdline: cmdline ?? '',
        });
        me.down('field[name=cmdline]').resetOriginalValue();
    },

    initComponent: function () {
        let me = this;

        me.items = [
            {
                xtype: 'proxmoxtextfield',
                name: 'url',
                fieldLabel: gettext('URL (.ins file)'),
                emptyText: 'https://…/generic.ins',
                regex: PVE.qemu.S390xMedia.urlRegex,
                regexText: gettext('An HTTP or HTTPS URL'),
                allowBlank: false,
                deleteEmpty: false,
            },
            {
                xtype: 'pveStorageSelector',
                name: 'storage',
                fieldLabel: gettext('Store files on'),
                storageContent: 'snippets',
                nodename: me.nodename,
                autoSelect: true,
                allowBlank: !me.isCreate,
            },
            {
                xtype: 'proxmoxcheckbox',
                name: 'refetch',
                fieldLabel: gettext('Fetch again'),
                hidden: me.isCreate,
                submitValue: true,
                uncheckedValue: 0,
            },
            {
                xtype: 'proxmoxtextfield',
                name: 'cmdline',
                fieldLabel: gettext('Kernel parameters'),
                emptyText: gettext('From the parameter file of the installer'),
                deleteEmpty: false,
            },
            {
                xtype: 'proxmoxcheckbox',
                name: 'once',
                fieldLabel: gettext('Boot once'),
                checked: true,
                uncheckedValue: 0,
            },
            {
                xtype: 'displayfield',
                userCls: 'pmx-hint',
                value: gettext(
                    'The kernel, initial RAM disk and parameter file listed in the .ins file are fetched once into the snippets of the storage. Booted once, the network boot is removed at the next start, as the installer sets the guest to re-IPL the installed system.',
                ),
            },
        ];

        me.callParent();
    },
});

Ext.define('PVE.qemu.NetbootEdit', {
    extend: 'Proxmox.window.Edit',

    backgroundDelay: 5,
    width: 500,

    initComponent: function () {
        let me = this;

        let nodename = me.pveSelNode.data.node;
        if (!nodename) {
            throw 'no node name specified';
        }

        me.isCreate = !me.confid;

        let ipanel = Ext.create('PVE.qemu.NetbootInputPanel', {
            isCreate: me.isCreate,
            nodename,
        });

        Ext.applyIf(me, {
            subject: gettext('Network Boot'),
            items: [ipanel],
        });

        me.callParent();

        if (!me.isCreate) {
            me.load({
                success: function (response) {
                    let conf = response.result.data;
                    if (conf.netboot) {
                        ipanel.setNetboot(conf.netboot, conf['netboot-cmdline']);
                    }
                },
            });
        }
    },
});

// The install media selection of the wizard on s390x nodes, instead of the CD/DVD drive.
Ext.define('PVE.qemu.S390xInstallMediaPanel', {
    extend: 'Proxmox.panel.InputPanel',
    alias: 'widget.pveQemuS390xInstallMediaPanel',

    insideWizard: true,

    viewModel: {
        data: {
            mediaType: 'netboot',
            machineList: [],
        },
        formulas: {
            // CD/DVD drives only exist on the virtio machine
            cdAllowed: function (get) {
                let machine = get('current.machine');
                let list = get('machineList');
                if (!machine || machine === '__default__') {
                    machine = PVE.qemu.Architecture.getS390xNewVmMachine(list);
                }
                return PVE.qemu.Architecture.getS390xMachineClass(machine, list) === 'virtio';
            },
            // the fields must stay disabled on other nodes, where the panel is disabled
            isS390xNode: (get) => get('current.architecture') === 's390x',
            isNetboot: (get) => get('isS390xNode') && get('mediaType') === 'netboot',
            isTape: (get) => get('isS390xNode') && get('mediaType') === 'tape',
            isCD: (get) => get('isS390xNode') && get('mediaType') === 'iso',
        },
    },

    onGetValues: function (values) {
        let me = this;
        let vm = me.getViewModel();
        let res = {};
        if (me.isDisabled()) {
            return res; // not an s390x node
        }
        let mediaType = vm.get('mediaType');
        if (mediaType === 'netboot') {
            res.netboot = PVE.Parser.printPropertyString(
                { url: values.netbooturl, storage: values.netbootstorage },
                'url',
            );
        } else if (mediaType === 'tape') {
            res.tape0 = values.tapeimage;
            // mainframe operating systems IPL from the tape, Linux uses the boot order
            if (!PVE.qemu.Architecture.isS390xLinux(vm.get('current.ostype'))) {
                res.ipl = 'tape0';
            }
        } else if (mediaType === 'iso' && vm.get('cdAllowed')) {
            let [bus, index] = PVE.qemu.Architecture.defaultCDDrive.s390x;
            res[`${bus}${index}`] = PVE.Parser.printQemuDrive({
                media: 'cdrom',
                file: values.cdimage,
            });
        }
        return res;
    },

    controller: {
        xclass: 'Ext.app.ViewController',

        onMediaChange: function (field, value) {
            if (value) {
                this.getViewModel().set('mediaType', field.inputValue);
            }
        },

        init: function (view) {
            let vm = this.getViewModel();
            vm.bind('{nodename}', (nodename) => {
                if (!nodename) {
                    return;
                }
                PVE.qemu.Architecture.loadS390xMachines(nodename, (list) => {
                    if (!view.isDestroyed) {
                        vm.set('machineList', list);
                    }
                });
            });
            // switching to a mainframe machine drops a selected CD/DVD image
            vm.bind('{cdAllowed}', (allowed) => {
                if (!allowed && vm.get('mediaType') === 'iso') {
                    view.down('radiofield[inputValue=none]').setValue(true);
                }
            });
        },

        control: {
            'radiofield[name=mediaType]': {
                change: 'onMediaChange',
            },
        },
    },

    items: [
        {
            xtype: 'radiofield',
            name: 'mediaType',
            inputValue: 'netboot',
            checked: true,
            submitValue: false,
            boxLabel: gettext('Use network boot (.ins file URL)'),
        },
        {
            xtype: 'proxmoxtextfield',
            name: 'netbooturl',
            fieldLabel: gettext('URL'),
            emptyText: 'https://…/generic.ins',
            regex: PVE.qemu.S390xMedia.urlRegex,
            regexText: gettext('An HTTP or HTTPS URL'),
            allowBlank: false,
            bind: {
                disabled: '{!isNetboot}',
                hidden: '{!isNetboot}',
            },
        },
        {
            xtype: 'pveStorageSelector',
            name: 'netbootstorage',
            fieldLabel: gettext('Store files on'),
            storageContent: 'snippets',
            autoSelect: true,
            allowBlank: false,
            bind: {
                nodename: '{nodename}',
                disabled: '{!isNetboot}',
                hidden: '{!isNetboot}',
            },
        },
        {
            xtype: 'radiofield',
            name: 'mediaType',
            inputValue: 'tape',
            submitValue: false,
            boxLabel: gettext('Use tape image file (AWSTAPE)'),
        },
        {
            xtype: 'pveIsoSelector',
            name: 'tapeimage',
            insideWizard: true,
            fileFilter: (rec) => PVE.qemu.S390xMedia.isTapeImage(rec.data.volid),
            fileLabel: gettext('Tape image'),
            bind: {
                nodename: '{nodename}',
                disabled: '{!isTape}',
                hidden: '{!isTape}',
            },
        },
        {
            xtype: 'radiofield',
            name: 'mediaType',
            inputValue: 'iso',
            submitValue: false,
            boxLabel: gettext('Use CD/DVD disc image file (iso), virtio machine only'),
            bind: {
                disabled: '{!cdAllowed}',
            },
        },
        {
            xtype: 'pveIsoSelector',
            name: 'cdimage',
            insideWizard: true,
            fileFilter: (rec) => !PVE.qemu.S390xMedia.isTapeImage(rec.data.volid),
            bind: {
                nodename: '{nodename}',
                disabled: '{!isCD}',
                hidden: '{!isCD}',
            },
        },
        {
            xtype: 'radiofield',
            name: 'mediaType',
            inputValue: 'none',
            submitValue: false,
            boxLabel: gettext('Do not use any media'),
        },
    ],
});
