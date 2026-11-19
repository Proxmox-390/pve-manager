Ext.define('PVE.qemu.MachineInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    xtype: 'pveMachineInputPanel',
    onlineHelp: 'qm_machine_type',

    viewModel: {
        data: {
            type: '__default__',
        },
        formulas: {
            q35: (get) => get('type') === 'q35',
            // s390x VMs have no vIOMMU (no PCI)
            i440fxViommu: (get) => get('type') !== 'q35' && get('arch') !== 's390x',
        },
    },

    controller: {
        xclass: 'Ext.app.ViewController',
        control: {
            'combobox[name=machine]': {
                change: 'onMachineChange',
            },
        },
        onMachineChange: function (field, value) {
            let me = this;
            let version = me.lookup('version');
            let store = version.getStore();

            let oldRec = store.findRecord('id', version.getValue(), 0, false, false, true);

            me.setVersionFilter(value);

            if (!me.getView().isWindows) {
                version.setValue('latest');
            } else {
                if (!oldRec) {
                    return;
                }
                let oldVers = oldRec.data.version;
                // we already filtered by correct type, so just check version property
                let rec = store.findRecord('version', oldVers, 0, false, false, true);
                if (rec) {
                    version.select(rec);
                }
            }
        },

        setVersionFilter: function (machineType) {
            let me = this;
            let vm = me.getViewModel();
            let arch = vm.get('arch');
            let defaultMachine = PVE.qemu.Architecture.defaultMachines[arch];
            if (defaultMachine === 'pc') {
                defaultMachine = 'i440fx'; // the default in the backend is 'pc' which means 'i440fx' for the qemu machinetype
            }
            let type = machineType === 'q35' ? 'q35' : defaultMachine;
            let mainframe = false;
            if (arch === 's390x' && machineType && machineType !== '__default__') {
                // the versions of the virtio machine, or of a mainframe machine type (czam-v1 of
                // czam), unversioned machine types have none
                type = machineType;
                mainframe = machineType !== defaultMachine;
            }
            let store = me.lookup('version').getStore();
            store.clearFilter();
            // a mainframe machine type's versions have its (family) type, e.g. czam-v1 of czam;
            // its own entry is the alias of the newest version: "Latest". Older qemu-server
            // versions gave each version its own type, so its name prefix counts too.
            store.addFilter(
                mainframe
                    ? (val) =>
                          val.data.id === 'latest' ||
                          (val.data.class === 'mainframe' &&
                              val.data.id !== type &&
                              (val.data.type === type || val.data.id.startsWith(`${type}-`)))
                    : (val) => val.data.id === 'latest' || val.data.type === type,
            );
            store.isWindows = me.getView().isWindows;
        },

        setArch: function (arch) {
            let me = this;
            let store = me.lookup('version').getStore();
            store.getProxy().setExtraParams({
                arch,
            });
            store.reload();
        },
    },

    onGetValues: function (values) {
        // arch is a hidden field used only for the machine-default lookup; do not submit it.
        let arch = values.arch;
        delete values.arch;
        if (values.delete === 'machine' && values.viommu) {
            delete values.delete;
            values.machine = PVE.qemu.Architecture.defaultMachines[arch];
        }
        if (values.version && values.version !== 'latest') {
            values.machine = values.version;
            delete values.delete;
        }
        delete values.version;
        if (values.delete === 'machine' && !values.viommu) {
            return values;
        }
        let ret = {};
        ret.machine = PVE.Parser.printPropertyString(values, 'machine');
        return ret;
    },

    setValues: function (values) {
        let me = this;

        let machineConf = PVE.Parser.parsePropertyString(values.machine, 'type');
        values.machine = machineConf.type;

        let defaultMachine = PVE.qemu.Architecture.defaultMachines[values.arch];
        me.isWindows = values.isWindows;
        if (values.arch === 's390x') {
            // explicit values only, see PVE.form.QemuMachineSelector
            let machine = values.machine;
            if (!machine || machine === '__default__') {
                machine = defaultMachine;
            }
            values.viommu = '__default__';
            values.machine = machine;
            // a pinned version of the virtio machine or of a mainframe machine type (czam-v1:
            // czam, version czam-v1)
            let mainframeVersion = machine.match(/^(.+)-v\d+$/);
            if (machine.startsWith(`${defaultMachine}-`)) {
                values.version = machine;
                values.machine = defaultMachine;
                me.setAdvancedVisible(true);
            } else if (mainframeVersion) {
                values.version = machine;
                values.machine = mainframeVersion[1];
                me.setAdvancedVisible(true);
            }
            me.getViewModel().set('arch', values.arch);
            // The s390x machine list loads asynchronously: the selector keeps a value until then,
            // but the binding of its value to 'type' would set the initial one again later.
            me.getViewModel().set('type', values.machine);
            me.lookup('machine').setNodename(values.nodename);
            this.callParent(arguments);
            this.getController().setVersionFilter(values.machine);
            this.getController().setArch(values.arch);
            return;
        }
        if (values.machine === defaultMachine) {
            values.machine = '__default__';
        }

        if (me.isWindows) {
            if (values.machine === '__default__' || values.machine === 'q35') {
                let effective = PVE.Utils.qemu_implicit_machine_version(
                    values.machine,
                    values.creationQemu,
                    values.arch,
                );
                values.effectiveVersion = effective + ' ' + gettext('(implicit)');
                me.lookup('effectiveVersion').setVisible(true);
                me.lookup('implicitVersionHint').setVisible(true);
                me.setAdvancedVisible(true);
            }
        }

        values.viommu = machineConf.viommu || '__default__';

        if (values.machine !== '__default__' && values.machine !== 'q35') {
            values.version = values.machine;
            values.machine = values.version.match(/q35/) ? 'q35' : '__default__';

            // avoid hiding a pinned version
            me.setAdvancedVisible(true);
        }

        this.callParent(arguments);
        this.getController().setVersionFilter(values.machine);
        this.getController().setArch(values.arch);
    },

    items: [
        {
            xtype: 'pveQemuMachineSelector',
            name: 'machine',
            reference: 'machine',
            fieldLabel: gettext('Machine'),
            value: '__default__',
            bind: {
                value: '{type}',
                category: '{arch}',
            },
        },
        {
            xtype: 'hidden',
            name: 'arch',
            reference: 'arch',
            bind: '{arch}',
        },
    ],

    advancedItems: [
        {
            xtype: 'combobox',
            name: 'version',
            reference: 'version',
            fieldLabel: gettext('Version'),
            emptyText: gettext('Latest'),
            value: 'latest',
            editable: false,
            valueField: 'id',
            displayField: 'version',
            queryParam: false,
            store: {
                autoLoad: true,
                fields: ['id', 'type', 'version', 'class'],
                proxy: {
                    type: 'proxmox',
                    url: '/api2/json/nodes/localhost/capabilities/qemu/machines',
                },
                listeners: {
                    load: function (store, records) {
                        // s390x: versions of mainframe machine types by their name (czam-v1),
                        // not the QEMU version
                        (records ?? []).forEach((rec) => {
                            if (rec.data.class === 'mainframe') {
                                rec.set('version', rec.data.id, { silent: true, commit: true });
                            }
                        });
                        if (!this.isWindows) {
                            this.insert(0, {
                                id: 'latest',
                                type: 'any',
                                version: gettext('Latest'),
                            });
                        }
                    },
                },
            },
        },
        {
            xtype: 'displayfield',
            name: 'effectiveVersion',
            fieldLabel: gettext('Current Version'),
            reference: 'effectiveVersion',
            submitValue: false,
            hidden: true,
        },
        {
            xtype: 'displayfield',
            reference: 'implicitVersionHint',
            userCls: 'pmx-hint',
            hidden: true,
            value: gettext(
                'No fixed version is set; the version is chosen automatically based on when the VM' +
                    ' was created. Pinning a specific version is recommended.',
            ),
        },
        {
            xtype: 'displayfield',
            fieldLabel: gettext('Note'),
            value: gettext(
                'Machine version change may affect hardware layout and settings in the guest OS.',
            ),
        },
        {
            xtype: 'proxmoxKVComboBox',
            name: 'viommu',
            fieldLabel: gettext('vIOMMU'),
            reference: 'viommu-q35',
            deleteEmpty: false,
            value: '__default__',
            comboItems: [
                ['__default__', Proxmox.Utils.defaultText + ' (None)'],
                ['intel', gettext('Intel (AMD Compatible)')],
                ['virtio', 'VirtIO'],
            ],
            bind: {
                hidden: '{!q35}',
                disabled: '{!q35}',
            },
        },
        {
            xtype: 'proxmoxKVComboBox',
            name: 'viommu',
            fieldLabel: gettext('vIOMMU'),
            reference: 'viommu-i440fx',
            deleteEmpty: false,
            value: '__default__',
            comboItems: [
                ['__default__', Proxmox.Utils.defaultText + ' (None)'],
                ['virtio', 'VirtIO'],
            ],
            bind: {
                hidden: '{!i440fxViommu}',
                disabled: '{!i440fxViommu}',
            },
        },
    ],
});

Ext.define('PVE.qemu.MachineEdit', {
    extend: 'Proxmox.window.Edit',

    subject: gettext('Machine'),

    items: {
        xtype: 'pveMachineInputPanel',
    },

    width: 400,

    initComponent: function () {
        let me = this;

        me.nodename = me.pveSelNode?.data.node;

        if (!me.nodename) {
            throw 'no nodename given';
        }

        me.callParent();

        me.load({
            success: function (response) {
                let conf = response.result.data;
                let values = {
                    machine: conf.machine || '__default__',
                };
                values.isWindows = PVE.Utils.is_windows(conf.ostype);
                values.arch = PVE.qemu.Architecture.getGuestArchitecture(conf.arch, me.nodename);
                values.nodename = me.nodename;
                if (conf.meta) {
                    let meta = PVE.Parser.parsePropertyString(conf.meta);
                    values.creationQemu = meta['creation-qemu'];
                }

                me.setValues(values);
            },
        });
    },
});
