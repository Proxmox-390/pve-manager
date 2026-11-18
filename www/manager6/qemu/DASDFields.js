// The settings of an s390x DASD (config keys fbaN and ckdN) in the hard disk dialog: device number,
// for a new CKD volume the 3390 model or cylinders, and the name of a new volume.
Ext.define('PVE.qemu.DASDFields', {
    extend: 'Ext.container.Container',
    alias: 'widget.pveQemuDASDFields',

    layout: 'anchor',
    defaults: {
        anchor: '100%',
    },

    kind: undefined, // 'fba', 'ckd' or undefined (no DASD, all fields disabled)
    isCreate: true,
    importDisk: false,
    nodename: undefined,
    vmid: undefined,
    autoSuggestDevno: true, // pre-fill the next free device number (not when editing a DASD)

    statics: {
        cylinderSize: 852480, // 15 tracks of 56832 bytes
        maxCylinders: 65520,

        // the 3390 models and their cylinders; QEMU-mod emulates 3390 volumes only, up to the
        // 65520 cylinders of a 3390-54 (no extended address volumes, 3390-A)
        ckdModels: [
            ['3390-1', 1113],
            ['3390-2', 2226],
            ['3390-3', 3339],
            ['3390-9', 10017],
            ['3390-27', 32760],
            ['3390-54', 65520],
        ],

        // address, size and volume of a DASD config entry, e.g.
        // "0.0.0200, 3390-9 (10017 cylinders), local:100/vm-100-SYSRS1.raw"
        renderDASD: function (key, value) {
            let drive = PVE.Parser.parseQemuDrive(key, value);
            if (!drive) {
                return Ext.htmlEncode(value);
            }
            let size = drive.size;
            if (drive.interface === 'ckd') {
                size = PVE.qemu.DASDFields.renderCKDSize(drive.cylinders);
            } else if (drive.media === 'cdrom') {
                size = undefined;
            }
            let parts = [drive.devno ?? gettext('no address'), size, drive.file];
            if (PVE.Parser.parseBoolean(drive.ro)) {
                parts.push(gettext('read-only'));
            }
            return Ext.htmlEncode(parts.filter((part) => !!part).join(', '));
        },

        // "3390-9 (10017 cylinders)" or "3390 (1234 cylinders)"
        renderCKDSize: function (cylinders) {
            cylinders = parseInt(cylinders, 10);
            if (!cylinders) {
                return '3390';
            }
            let model = PVE.qemu.DASDFields.ckdModels.find(([, cyl]) => cyl === cylinders);
            return `${model ? model[0] : '3390'} (${cylinders} ${gettext('cylinders')})`;
        },
    },

    // device numbers of other DASDs being created in the same wizard
    getUsedDevnos: function () {
        let me = this;
        let wizardDisks = me.up('pveMultiHDPanel');
        if (!wizardDisks) {
            return [];
        }
        let own = me.down('pveCcwDevnoField');
        return wizardDisks
            .query('pveCcwDevnoField')
            .filter((field) => field !== own && !field.isDisabled())
            .map((field) => field.getValue())
            .filter((value) => !!value);
    },

    setKind: function (kind) {
        let me = this;
        me.kind = kind;
        let devno = me.down('pveCcwDevnoField');
        devno.setDisabled(!kind);
        if (kind) {
            me.resolveVMID();
            devno.setKind(kind);
        }
        let name = me.down('field[name=dasdName]');
        name.setDisabled(!kind || !me.isCreate || me.importDisk);
        let ckdCreate = kind === 'ckd' && me.isCreate && !me.importDisk;
        for (const field of me.query('[ckdCreate]')) {
            field.setVisible(ckdCreate);
            field.setDisabled(!ckdCreate);
        }
        me.down('field[name=ckdSize]').setVisible(kind === 'ckd' && !me.isCreate);
        me.down('#ckdStorageHint').setVisible(kind === 'ckd');
        me.updateCylinders();
    },

    // In the creation wizard, the VM ID comes from its general tab.
    resolveVMID: function () {
        let me = this;
        let vmid = me.vmid ?? me.up('window')?.down('pveGuestIDSelector')?.getValue();
        if (vmid && me.nodename) {
            me.down('pveCcwDevnoField').setVMConfig(me.nodename, vmid);
        }
    },

    setNodename: function (nodename) {
        let me = this;
        me.nodename = nodename;
        if (me.kind) {
            me.resolveVMID();
        }
    },

    setVMID: function (vmid) {
        let me = this;
        me.vmid = vmid;
        me.down('pveCcwDevnoField').setVMConfig(me.nodename, vmid);
    },

    updateCylinders: function () {
        let me = this;
        let model = me.down('field[name=ckdModel]');
        let cylinders = me.down('field[name=ckdCylinders]');
        let custom = model.getValue() === '__custom__';
        if (!custom) {
            let entry = PVE.qemu.DASDFields.ckdModels.find(([name]) => name === model.getValue());
            cylinders.setValue(entry ? entry[1] : undefined);
        }
        cylinders.setReadOnly(!custom);
    },

    // set the values of an existing drive
    setDrive: function (drive) {
        let me = this;
        me.down('pveCcwDevnoField').setValue(drive.devno);
        me.down('field[name=ckdSize]').setValue(
            me.kind === 'ckd' ? PVE.qemu.DASDFields.renderCKDSize(drive.cylinders) : '',
        );
    },

    // put the values into the drive
    applyToDrive: function (drive) {
        let me = this;
        let values = {};
        me.query('field').forEach((field) => {
            if (!field.isDisabled()) {
                values[field.getName()] = field.getValue();
            }
        });
        drive.devno = values.devno;
        if (me.isCreate) {
            PVE.Utils.propertyStringSet(drive, values.dasdName, 'name');
        }
        if (values.ckdModel === '__custom__') {
            drive.cylinders = values.ckdCylinders;
        } else if (values.ckdModel) {
            drive.model = values.ckdModel;
        }
    },

    initComponent: function () {
        let me = this;

        let modelItems = PVE.qemu.DASDFields.ckdModels.map(([name, cylinders]) => [
            name,
            `${name} (${cylinders} ${gettext('cylinders')})`,
        ]);
        modelItems.push(['__custom__', gettext('Custom')]);

        me.items = [
            {
                xtype: 'pveCcwDevnoField',
                name: 'devno',
                kind: me.kind,
                autoSuggest: me.autoSuggestDevno,
                getUsedDevnos: () => me.getUsedDevnos(),
            },
            {
                xtype: 'proxmoxKVComboBox',
                name: 'ckdModel',
                fieldLabel: gettext('Type'),
                ckdCreate: true,
                value: '3390-9',
                allowBlank: false,
                comboItems: modelItems,
                listeners: {
                    change: () => me.updateCylinders(),
                },
            },
            {
                xtype: 'proxmoxintegerfield',
                name: 'ckdCylinders',
                fieldLabel: gettext('Cylinders'),
                ckdCreate: true,
                minValue: 1,
                maxValue: PVE.qemu.DASDFields.maxCylinders,
                allowBlank: false,
                readOnly: true,
                autoEl: {
                    tag: 'div',
                    'data-qtip': gettext('One cylinder has 15 tracks of 56832 bytes'),
                },
            },
            {
                xtype: 'textfield',
                name: 'dasdName',
                fieldLabel: gettext('Name'),
                hidden: !me.isCreate || me.importDisk,
                disabled: !me.isCreate || me.importDisk,
                allowBlank: true,
                emptyText: gettext('automatic'),
                maxLength: 40,
                regex: /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
                regexText: gettext('Letters, digits, - and _'),
                autoEl: {
                    tag: 'div',
                    'data-qtip': gettext(
                        'The volume is called vm-<VMID>-<name>, e.g. the volume serial the guest will give it. The guest writes the volume serial itself, e.g. with ICKDSF.',
                    ),
                },
            },
            {
                xtype: 'displayfield',
                name: 'ckdSize',
                fieldLabel: gettext('Type'),
                submitValue: false,
                hidden: me.isCreate,
            },
            {
                xtype: 'displayfield',
                itemId: 'ckdStorageHint',
                userCls: 'pmx-hint',
                submitValue: false,
                hidden: true,
                value: gettext(
                    'CKD volumes on network storage (Ceph RBD, NFS) are slow: the channel programs of the guest do synchronous I/O. Prefer local ZFS or LVM storage.',
                ),
            },
        ];

        me.callParent();

        me.setKind(me.kind);
    },
});
