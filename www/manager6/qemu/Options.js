Ext.define('PVE.qemu.Options', {
    extend: 'Proxmox.grid.PendingObjectGrid',
    alias: ['widget.PVE.qemu.Options'],

    onlineHelp: 'qm_options',

    initComponent: function () {
        var me = this;

        var nodename = me.pveSelNode.data.node;
        if (!nodename) {
            throw 'no node name specified';
        }

        var vmid = me.pveSelNode.data.vmid;
        if (!vmid) {
            throw 'no VM ID specified';
        }

        var caps = Ext.state.Manager.get('GuiCap');

        let s390x = PVE.qemu.Architecture.getNodeArchitecture(nodename) === 's390x';

        var rows = {
            name: {
                required: true,
                defaultValue: me.pveSelNode.data.name,
                header: gettext('Name'),
                editor: caps.vms['VM.Config.Options']
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: gettext('Name'),
                          items: {
                              xtype: 'inputpanel',
                              items: {
                                  xtype: 'textfield',
                                  name: 'name',
                                  vtype: 'DnsName',
                                  value: '',
                                  fieldLabel: gettext('Name'),
                                  allowBlank: true,
                              },
                              onGetValues: function (values) {
                                  var params = values;
                                  if (
                                      values.name === undefined ||
                                      values.name === null ||
                                      values.name === ''
                                  ) {
                                      params = { delete: 'name' };
                                  }
                                  return params;
                              },
                          },
                      }
                    : undefined,
            },
            onboot: {
                header: gettext('Start at boot'),
                defaultValue: '',
                renderer: Proxmox.Utils.format_boolean,
                editor: caps.vms['VM.Config.Options']
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: gettext('Start at boot'),
                          items: {
                              xtype: 'proxmoxcheckbox',
                              name: 'onboot',
                              uncheckedValue: 0,
                              defaultValue: 0,
                              deleteDefaultValue: true,
                              fieldLabel: gettext('Start at boot'),
                          },
                      }
                    : undefined,
            },
            startup: {
                header: gettext('Start/Shutdown order'),
                defaultValue: '',
                renderer: PVE.Utils.render_kvm_startup,
                editor:
                    caps.vms['VM.Config.Options'] && caps.nodes['Sys.Modify']
                        ? {
                              xtype: 'pveWindowStartupEdit',
                              onlineHelp: 'qm_startup_and_shutdown',
                          }
                        : undefined,
            },
            ostype: {
                header: gettext('OS Type'),
                editor: caps.vms['VM.Config.Options']
                    ? { xtype: 'pveQemuOSTypeEdit', nodename }
                    : undefined,
                renderer: PVE.Utils.render_kvm_ostype,
                defaultValue: 'other',
            },
            bootdisk: {
                visible: false,
            },
            boot: {
                header: gettext('Boot Order'),
                defaultValue: 'cdn',
                editor: caps.vms['VM.Config.Disk'] ? 'PVE.qemu.BootOrderEdit' : undefined,
                multiKey: ['boot', 'bootdisk'],
                renderer: function (order, metaData, record, rowIndex, colIndex, store, pending) {
                    if (/^\s*$/.test(order)) {
                        return gettext('(No boot device selected)');
                    }
                    let boot = PVE.Parser.parsePropertyString(order, 'legacy');
                    if (boot.order) {
                        let list = boot.order.split(';');
                        let ret = '';
                        list.forEach((dev) => {
                            if (ret) {
                                ret += ', ';
                            }
                            ret += dev;
                        });
                        return ret;
                    }

                    // legacy style and fallback
                    let i;
                    var text = '';
                    var bootdisk = me.getObjectValue('bootdisk', undefined, pending);
                    order = boot.legacy || 'cdn';
                    for (i = 0; i < order.length; i++) {
                        if (text) {
                            text += ', ';
                        }
                        let sel = order.substring(i, i + 1);
                        if (sel === 'c') {
                            if (bootdisk) {
                                text += bootdisk;
                            } else {
                                text += gettext('first disk');
                            }
                        } else if (sel === 'n') {
                            text += gettext('any net');
                        } else if (sel === 'a') {
                            text += gettext('Floppy');
                        } else if (sel === 'd') {
                            text += gettext('any CD-ROM');
                        } else {
                            text += sel;
                        }
                    }
                    return text;
                },
            },
            // s390x VMs IPL from this device, if set, instead of the boot order; the boot order
            // is only shown for Linux, other OS types have no firmware boot order (see below)
            ipl: {
                header: 'IPL',
                required: true,
                visible: s390x,
                editor: caps.vms['VM.Config.Disk'] ? 'PVE.qemu.IPLEdit' : undefined,
                renderer: function (value, metaData, record, ri, ci, store, pending) {
                    let text = `${Proxmox.Utils.defaultText} (${gettext('boot order')})`;
                    if (value) {
                        let ipl = PVE.Parser.parsePropertyString(value, 'device');
                        text = Ext.htmlEncode(ipl.device ?? '');
                        if (ipl.loadparm) {
                            text += `, ${gettext('loadparm')} ${Ext.htmlEncode(ipl.loadparm)}`;
                        }
                    }
                    // a network boot replaces the IPL (once: at the next start)
                    let netboot = me.getObjectValue('netboot', undefined, pending);
                    if (netboot) {
                        let once = PVE.Parser.parseBoolean(
                            PVE.Parser.parsePropertyString(netboot, 'url').once,
                            true,
                        );
                        return once
                            ? `${gettext('Network boot')} (${gettext('once')}), ${gettext('then')} ${text}`
                            : gettext('Network boot');
                    }
                    return text;
                },
            },
            // s390x: the network boot of an installer (also in the hardware view)
            netboot: {
                header: gettext('Network Boot'),
                visible: s390x,
                editor: caps.vms['VM.Config.CDROM'] ? 'PVE.qemu.NetbootEdit' : undefined,
                renderer: (value) => PVE.qemu.S390xMedia.renderNetboot(value),
            },
            // the code page of the line-mode console (mainframe operating systems, see below)
            'sclplm-codepage': {
                header: gettext('Line-mode console code page'),
                required: true,
                visible: false,
                defaultValue: '',
                renderer: (value) =>
                    value
                        ? Ext.htmlEncode(value.toUpperCase())
                        : `${Proxmox.Utils.defaultText} (CP037)`,
                editor: caps.vms['VM.Config.Options']
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: gettext('Line-mode console code page'),
                          width: 450,
                          items: [
                              {
                                  xtype: 'proxmoxKVComboBox',
                                  name: 'sclplm-codepage',
                                  fieldLabel: gettext('Code page'),
                                  value: '__default__',
                                  comboItems: [
                                      ['__default__', `${Proxmox.Utils.defaultText} (CP037)`],
                                      ['cp037', 'CP037'],
                                      ['cp500', 'CP500 (Linux)'],
                                  ],
                              },
                              {
                                  xtype: 'displayfield',
                                  userCls: 'pmx-hint',
                                  value: gettext(
                                      "The EBCDIC code page of the guest on the line-mode console. Linux takes '%' to switch the case of the input: enter '%%' for a '%'. Applies at the next start.",
                                  ),
                              },
                          ],
                      }
                    : undefined,
            },
            // forwarding of the line-mode console (mainframe operating systems, see below)
            'sclplm-syslog': {
                header: gettext('Line-mode console syslog'),
                required: true,
                visible: false,
                editor: caps.vms['VM.Config.Options'] ? 'PVE.qemu.SclpSyslogEdit' : undefined,
                renderer: function (value) {
                    if (!value) {
                        return Proxmox.Utils.NoneText;
                    }
                    let syslog = PVE.Parser.parsePropertyString(value, 'host');
                    let host = Ext.htmlEncode(syslog.host ?? '');
                    if (host.includes(':')) {
                        host = `[${host}]`;
                    }
                    let proto = (syslog.proto ?? 'udp').toUpperCase();
                    let facility = Ext.htmlEncode(syslog.facility ?? 'local0');
                    return `${proto} ${host}:${syslog.port ?? 514} (${facility})`;
                },
            },
            tablet: {
                header: gettext('Use tablet for pointer'),
                defaultValue: true,
                renderer: Proxmox.Utils.format_boolean,
                editor: caps.vms['VM.Config.HWType']
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: gettext('Use tablet for pointer'),
                          items: {
                              xtype: 'proxmoxcheckbox',
                              name: 'tablet',
                              checked: true,
                              uncheckedValue: 0,
                              defaultValue: 1,
                              deleteDefaultValue: true,
                              fieldLabel: gettext('Enabled'),
                          },
                      }
                    : undefined,
            },
            hotplug: {
                header: gettext('Hotplug'),
                defaultValue: 'disk,network,usb',
                renderer: PVE.Utils.render_hotplug_features,
                editor: caps.vms['VM.Config.HWType']
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: gettext('Hotplug'),
                          items: {
                              xtype: 'pveHotplugFeatureSelector',
                              name: 'hotplug',
                              value: '',
                              multiSelect: true,
                              fieldLabel: gettext('Hotplug'),
                              allowBlank: true,
                          },
                      }
                    : undefined,
            },
            acpi: {
                header: gettext('ACPI support'),
                defaultValue: true,
                renderer: Proxmox.Utils.format_boolean,
                editor: caps.vms['VM.Config.HWType']
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: gettext('ACPI support'),
                          items: {
                              xtype: 'proxmoxcheckbox',
                              name: 'acpi',
                              checked: true,
                              uncheckedValue: 0,
                              defaultValue: 1,
                              deleteDefaultValue: true,
                              fieldLabel: gettext('Enabled'),
                          },
                      }
                    : undefined,
            },
            kvm: {
                header: gettext('KVM hardware virtualization'),
                defaultValue: true,
                renderer: Proxmox.Utils.format_boolean,
                editor: caps.vms['VM.Config.HWType']
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: gettext('KVM hardware virtualization'),
                          items: {
                              xtype: 'proxmoxcheckbox',
                              name: 'kvm',
                              checked: true,
                              uncheckedValue: 0,
                              defaultValue: 1,
                              deleteDefaultValue: true,
                              fieldLabel: gettext('Enabled'),
                          },
                      }
                    : undefined,
            },
            freeze: {
                header: gettext('Freeze CPU at startup'),
                defaultValue: false,
                renderer: Proxmox.Utils.format_boolean,
                editor: caps.vms['VM.PowerMgmt']
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: gettext('Freeze CPU at startup'),
                          items: {
                              xtype: 'proxmoxcheckbox',
                              name: 'freeze',
                              uncheckedValue: 0,
                              defaultValue: 0,
                              deleteDefaultValue: true,
                              labelWidth: 140,
                              fieldLabel: gettext('Freeze CPU at startup'),
                          },
                      }
                    : undefined,
            },
            localtime: {
                header: gettext('Use local time for RTC'),
                defaultValue: '__default__',
                renderer: PVE.Utils.render_localtime,
                editor: caps.vms['VM.Config.Options']
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: gettext('Use local time for RTC'),
                          width: 400,
                          items: {
                              xtype: 'proxmoxKVComboBox',
                              name: 'localtime',
                              value: '__default__',
                              comboItems: [
                                  ['__default__', PVE.Utils.render_localtime('__default__')],
                                  [1, PVE.Utils.render_localtime(1)],
                                  [0, PVE.Utils.render_localtime(0)],
                              ],
                              labelWidth: 140,
                              fieldLabel: gettext('Use local time for RTC'),
                          },
                      }
                    : undefined,
            },
            startdate: {
                header: gettext('RTC start date'),
                defaultValue: 'now',
                editor: caps.vms['VM.Config.Options']
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: gettext('RTC start date'),
                          items: {
                              xtype: 'proxmoxtextfield',
                              name: 'startdate',
                              deleteEmpty: true,
                              value: 'now',
                              fieldLabel: gettext('RTC start date'),
                              vtype: 'QemuStartDate',
                              allowBlank: true,
                          },
                      }
                    : undefined,
            },
            smbios1: {
                header: gettext('SMBIOS settings (type1)'),
                defaultValue: '',
                renderer: Ext.String.htmlEncode,
                editor: caps.vms['VM.Config.HWType'] ? 'PVE.qemu.Smbios1Edit' : undefined,
            },
            // s390x: hidden for mainframe operating systems unless set (see below)
            agent: {
                header: 'QEMU Guest Agent',
                defaultValue: false,
                renderer: PVE.Utils.render_qga_features,
                editor: caps.vms['VM.Config.Options']
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: gettext('Qemu Agent'),
                          width: 350,
                          onlineHelp: 'qm_qemu_agent',
                          items: {
                              xtype: 'pveAgentFeatureSelector',
                              name: 'agent',
                          },
                      }
                    : undefined,
            },
            protection: {
                header: gettext('Protection'),
                defaultValue: false,
                renderer: Proxmox.Utils.format_boolean,
                editor: caps.vms['VM.Config.Options']
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: gettext('Protection'),
                          items: {
                              xtype: 'proxmoxcheckbox',
                              name: 'protection',
                              uncheckedValue: 0,
                              defaultValue: 0,
                              deleteDefaultValue: true,
                              fieldLabel: gettext('Enabled'),
                          },
                      }
                    : undefined,
            },
            spice_enhancements: {
                header: gettext('Spice Enhancements'),
                defaultValue: false,
                renderer: PVE.Utils.render_spice_enhancements,
                editor: caps.vms['VM.Config.Options']
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: gettext('Spice Enhancements'),
                          onlineHelp: 'qm_spice_enhancements',
                          items: {
                              xtype: 'pveSpiceEnhancementSelector',
                              name: 'spice_enhancements',
                          },
                      }
                    : undefined,
            },
            vmstatestorage: {
                header: gettext('VM State storage'),
                defaultValue: '',
                renderer: (val) => val || gettext('Automatic'),
                editor: caps.vms['VM.Config.Options']
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: gettext('VM State storage'),
                          onlineHelp: 'qm_vmstatestorage',
                          width: 350,
                          items: {
                              xtype: 'pveStorageSelector',
                              storageContent: 'vm-state',
                              allowBlank: true,
                              emptyText: gettext("Automatic (Storage used by the VM, or 'local')"),
                              autoSelect: false,
                              deleteEmpty: true,
                              skipEmptyText: true,
                              nodename: nodename,
                              name: 'vmstatestorage',
                          },
                      }
                    : undefined,
            },
            'amd-sev': {
                header: gettext('AMD SEV'),
                editor: caps.vms['VM.Config.HWType'] ? 'PVE.qemu.SevEdit' : undefined,
                defaultValue: Proxmox.Utils.defaultText + ' (' + Proxmox.Utils.disabledText + ')',
                renderer: function (value, metaData, record, ri, ci, store, pending) {
                    let amd_sev = PVE.Parser.parsePropertyString(value, 'type');
                    if (amd_sev.type === 'std') {
                        return 'AMD SEV (' + value + ')';
                    }
                    if (amd_sev.type === 'es') {
                        return 'AMD SEV-ES (' + value + ')';
                    }
                    if (amd_sev.type === 'snp') {
                        return 'AMD SEV-SNP (' + value + ')';
                    }
                    return value;
                },
            },
            'intel-tdx': {
                header: gettext('Intel TDX'),
                editor: caps.vms['VM.Config.HWType'] ? 'PVE.qemu.TdxEdit' : undefined,
                defaultValue: Proxmox.Utils.defaultText + ' (' + Proxmox.Utils.disabledText + ')',
                renderer: function (value, metaData, record, ri, ci, store, pending) {
                    let intel_tdx = PVE.Parser.parsePropertyString(value, 'type');
                    if (intel_tdx.type === 'tdx') {
                        return 'Intel (' + value + ')';
                    }
                    return value;
                },
            },
            hookscript: {
                header: gettext('Hookscript'),
            },
        };

        if (s390x) {
            // PC hardware s390x VMs do not have: no USB pointer, ACPI, SMBIOS, SPICE or x86
            // memory encryption (s390x has Secure Execution instead); no real-time clock, the
            // TOD clock follows the host; KVM is required; hot-plugging is what qemu-server
            // supports for the devices
            let hidden = [
                'tablet',
                'hotplug',
                'acpi',
                'kvm',
                'localtime',
                'startdate',
                'smbios1',
                'spice_enhancements',
                'amd-sev',
                'intel-tdx',
            ];
            hidden.forEach((key) => {
                rows[key].visible = false;
            });
        }

        var baseurl = 'nodes/' + nodename + '/qemu/' + vmid + '/config';

        var edit_btn = new Ext.Button({
            text: gettext('Edit'),
            disabled: true,
            handler: function () {
                me.run_editor();
            },
        });

        var revert_btn = new PVE.button.PendingRevert();

        var set_button_status = function () {
            var sm = me.getSelectionModel();
            var rec = sm.getSelection()[0];

            if (!rec) {
                edit_btn.disable();
                return;
            }

            var key = rec.data.key;
            var pending = rec.data.delete || me.hasPendingChanges(key);
            var rowdef = rows[key];

            edit_btn.setDisabled(!rowdef.editor);
            revert_btn.setDisabled(!pending);
        };

        Ext.apply(me, {
            url: '/api2/json/nodes/' + nodename + '/qemu/' + vmid + '/pending',
            interval: 5000,
            cwidth1: 250,
            tbar: [edit_btn, revert_btn],
            rows: rows,
            editorConfig: {
                url: '/api2/extjs/' + baseurl,
            },
            listeners: {
                itemdblclick: me.run_editor,
                selectionchange: set_button_status,
            },
        });

        me.callParent();

        me.on('activate', () => me.rstore.startUpdate());
        me.on('destroy', () => me.rstore.stopUpdate());
        me.on('deactivate', () => me.rstore.stopUpdate());

        me.mon(me.getStore(), 'datachanged', function () {
            set_button_status();
        });

        if (s390x) {
            // the (pending) OS type decides whether the boot order is shown, next to the IPL, or the
            // syslog forwarding of the line-mode console
            me.mon(me.rstore, 'load', function () {
                let ostype = me.getObjectValue('ostype', undefined, true);
                let boot = PVE.qemu.Architecture.isS390xLinux(ostype);
                // the QEMU guest agent is a Linux program, mainframe operating systems have
                // none: only shown for them if set, so it can be turned off
                let agent = boot || !!me.getObjectValue('agent', undefined, true);
                // only the mainframe operating systems have the line-mode console
                if (
                    rows.boot.visible !== boot ||
                    rows['sclplm-syslog'].visible !== !boot ||
                    rows['sclplm-codepage'].visible !== !boot ||
                    rows.agent.visible !== agent
                ) {
                    rows.boot.visible = boot;
                    rows['sclplm-syslog'].visible = !boot;
                    rows['sclplm-codepage'].visible = !boot;
                    rows.agent.visible = agent;
                    // apply the row filter again (store.filter() without a filter does not)
                    let filters = me.getStore().getFilters();
                    let rowFilters = filters.getRange();
                    filters.removeAll();
                    filters.add(rowFilters);
                }
                // the IPL row shows a network boot
                let netboot = me.getObjectValue('netboot', undefined, true) ?? '';
                if (netboot !== me.lastNetboot) {
                    me.lastNetboot = netboot;
                    me.getView().refresh();
                }
            });
        }
    },
});
