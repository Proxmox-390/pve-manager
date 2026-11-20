package PVE::S390xQeth;

# The qeth network devices (OSA-Express, HiperSockets) of an s390x node: CCW group devices of a
# read, a write and a data subchannel. Linux only creates a network interface for one once it is
# set online, which the s390-tools zdev tools do: 'lszdev qeth' lists the qeth devices the node
# can use (with the groups auto-detected from the subchannels of a CHPID), 'chzdev -e qeth <id>'
# sets one online, now and persistently (udev rules in /etc/udev/rules.d).
#
# Only qeth devices: lszdev lists the devices of one type, so FCP and DASD devices (which may carry
# the root file system of the node) never show up here, and enable() only takes a device lszdev
# lists as a qeth device that is offline. disable() sets an online one offline ('chzdev -d', now and
# persistently), unless the node uses it: an interface of it in the network configuration, or
# the management address of the node on it.

use strict;
use warnings;

use JSON;

use PVE::Cluster;
use PVE::INotify;
use PVE::Tools qw(run_command);

our $LSZDEV = '/usr/sbin/lszdev';
our $CHZDEV = '/usr/sbin/chzdev';
our $IP = '/usr/sbin/ip';
our $INTERFACES = '/etc/network/interfaces';

# a CCW bus ID, e.g. 0.0.0610 (channel subsystem, subchannel set, device number)
our $BUSID_RE = qr/[0-9a-f]{1,2}\.[0-3]\.[0-9a-f]{4}/;

# a qeth group: read, write and data device, e.g. 0.0.0610:0.0.0611:0.0.0612
our $GROUP_RE = qr/$BUSID_RE:$BUSID_RE:$BUSID_RE/;

my $COLUMNS = 'ID,ON,PERS,NAMES';

# Parse the output of 'lszdev qeth --pairs --columns ID,ON,PERS,NAMES' (one line per device,
# KEY="value" pairs). Returns a list of { id, device, online, persistent, names } sorted by the
# read device; lines without a valid qeth group ID are skipped.
sub parse_lszdev_pairs {
    my ($text) = @_;

    my $res = [];
    for my $line (split(/\n/, $text // '')) {
        my $pairs = {};
        while ($line =~ m/([A-Z]+)="([^"]*)"/g) {
            $pairs->{$1} = $2;
        }
        my $id = lc($pairs->{ID} // '');
        next if $id !~ m/^$GROUP_RE$/;

        my ($device) = split(/:/, $id);
        push @$res,
            {
                id => $id,
                device => $device,
                online => ($pairs->{ON} // '') eq 'yes' ? 1 : 0,
                persistent => ($pairs->{PERS} // '') eq 'yes' ? 1 : 0,
                names => [grep { length($_) } split(/\s+/, $pairs->{NAMES} // '')],
            };
    }

    return [sort { busid_key($a->{device}) <=> busid_key($b->{device}) } @$res];
}

# a sort key for a CCW bus ID (channel subsystem, subchannel set, device number)
sub busid_key {
    my ($busid) = @_;
    my ($cssid, $ssid, $devno) = split(/\./, $busid);
    return (hex($cssid) << 18) | (hex($ssid) << 16) | hex($devno);
}

# The device of $list that $device names: its group ID or its read device.
sub find_device {
    my ($list, $device) = @_;

    $device = lc($device // '');
    for my $dev (@$list) {
        return $dev if $dev->{id} eq $device || $dev->{device} eq $device;
    }
    return undef;
}

# The command that sets a qeth device online, in layer 2 mode (a network interface with its own
# MAC address that a Linux bridge can use). $bridge_port: the device will be the port of a bridge,
# so it takes over the promiscuous mode of the bridge (bridge_reflect_promisc=primary): the OSA then
# passes the frames for the MAC addresses of the guests behind the bridge to it.
sub enable_command {
    my ($dev, $bridge_port) = @_;

    my $cmd = [$CHZDEV, '--enable', '--yes', 'qeth', $dev->{id}, 'layer2=1'];
    push @$cmd, 'bridge_reflect_promisc=primary' if $bridge_port;
    return $cmd;
}

sub check_tools {
    die "the s390-tools zdev tools (lszdev, chzdev) are not installed\n"
        if !-x $LSZDEV || !-x $CHZDEV;
}

# The qeth devices of the node, see parse_lszdev_pairs().
sub list_devices {
    check_tools();

    my $output = '';
    run_command(
        [$LSZDEV, 'qeth', '--pairs', '--columns', $COLUMNS],
        outfunc => sub { $output .= "$_[0]\n" },
        timeout => 30,
    );
    return parse_lszdev_pairs($output);
}

# Set the offline qeth device $device (group ID or read device) online, persistently. Refuses
# devices that lszdev does not list as qeth devices and devices that are online already.
sub enable {
    my ($device, $bridge_port) = @_;

    die "invalid qeth device '$device'\n"
        if $device !~ m/^(?:$GROUP_RE|$BUSID_RE)$/i;

    my $dev = find_device(list_devices(), $device)
        or die "'$device' is no qeth device of this node\n";
    die "qeth device $dev->{id} is online already\n" if $dev->{online};

    my $errors = '';
    eval {
        run_command(
            enable_command($dev, $bridge_port),
            outfunc => sub { },
            errfunc => sub { $errors .= "$_[0]\n" },
            timeout => 120,
        );
    };
    if (my $err = $@) {
        $errors =~ s/\s+$//;
        die "setting qeth device $dev->{id} online failed: " . ($errors ne '' ? "$errors\n" : $err);
    }

    return find_device(list_devices(), $dev->{id}) // $dev;
}

# The command that sets a qeth device offline, now and persistently.
sub disable_command {
    my ($dev) = @_;
    return [$CHZDEV, '--disable', '--yes', 'qeth', $dev->{id}];
}

# The interface of @$names (the interfaces of a qeth device) that the network configuration
# $text (/etc/network/interfaces and the files it sources) uses, or undef: as an interface of its
# own, a VLAN on it (<name>.<tag>) or a port, slave or raw device of another interface. Comments do
# not count.
sub config_uses_interface {
    my ($text, $names) = @_;

    my $wanted = { map { $_ => 1 } @$names };
    for my $line (split(/\n/, $text // '')) {
        $line =~ s/#.*$//;
        for my $token (split(/[\s,]+/, $line)) {
            my $name = $token =~ s/\.\d+$//r; # a VLAN on the interface
            return $name if $wanted->{$name};
        }
    }
    return undef;
}

# The network configuration of the node: /etc/network/interfaces and the files in
# /etc/network/interfaces.d, which it usually sources.
sub read_network_config {
    my $text = '';
    for my $file ($INTERFACES, glob('/etc/network/interfaces.d/*')) {
        next if !-f $file;
        $text .= PVE::Tools::file_get_contents($file) . "\n";
    }
    return $text;
}

# Which address of @$addresses (the management addresses of the node) the interfaces @$names
# carry, or the interfaces stacked on them: a bridge they are ports of, a VLAN or bond on them,
# and so on. $links: the output of 'ip -json address show', decoded. Returns
# [<address>, <interface>] or undef. Without known management addresses, any global address
# counts as one.
sub interface_carrying_address {
    my ($links, $names, $addresses) = @_;

    my $set = { map { $_ => 1 } @$names };
    # interfaces stacked on the set: VLANs ('link') and ports' bridges or bonds ('master')
    my $changed = 1;
    while ($changed) {
        $changed = 0;
        for my $link (@$links) {
            my $name = $link->{ifname} // next;
            my $add = [];
            push @$add, $name
                if !$set->{$name} && defined($link->{link}) && $set->{ $link->{link} };
            push @$add, $link->{master}
                if $set->{$name} && defined($link->{master}) && !$set->{ $link->{master} };
            for my $new (@$add) {
                $set->{$new} = 1;
                $changed = 1;
            }
        }
    }

    my $wanted = { map { lc($_) => 1 } @{ $addresses // [] } };
    for my $link (@$links) {
        next if !$set->{ $link->{ifname} // '' };
        for my $addr (@{ $link->{addr_info} // [] }) {
            my $local = $addr->{local} // next;
            if (%$wanted) {
                return [$local, $link->{ifname}] if $wanted->{ lc($local) };
            } elsif (($addr->{scope} // '') eq 'global') {
                return [$local, $link->{ifname}];
            }
        }
    }
    return undef;
}

# The management addresses of the node: the address the cluster uses for it (from the cluster
# configuration or its host name).
sub management_addresses {
    my $nodename = PVE::INotify::nodename();
    my $ip = eval { PVE::Cluster::remote_node_ip($nodename, 1) };
    return [$ip] if $ip;
    return [];
}

# Why the online qeth device $dev cannot be set offline: the node uses it. Undef if it can.
# $config: the network configuration (see read_network_config()), $links: see
# interface_carrying_address(), $addresses: the management addresses of the node.
sub in_use_reason {
    my ($dev, $config, $links, $addresses) = @_;

    my $names = $dev->{names} // [];
    return undef if !@$names;
    if (my $name = config_uses_interface($config, $names)) {
        return "its interface $name is in the network configuration of the node"
            . " (/etc/network/interfaces), remove it there first";
    }
    if (my $carrier = interface_carrying_address($links, $names, $addresses)) {
        my ($address, $iface) = @$carrier;
        return "it carries the management address $address of the node"
            . ($iface ne $names->[0] ? " (on $iface)" : '');
    }
    return undef;
}

# The network state for in_use_reason(): the network configuration, the links with their
# addresses, the management addresses.
sub network_state {
    my $json = '';
    eval {
        run_command(
            [$IP, '-json', 'address', 'show'],
            outfunc => sub { $json .= "$_[0]\n" },
            timeout => 10,
        );
    };
    my $links = eval { decode_json($json) } // [];
    return (read_network_config(), $links, management_addresses());
}

# The qeth devices of the node (see list_devices()), each online one with 'in-use': why it
# cannot be set offline, if so.
sub list_devices_with_usage {
    my $devices = list_devices();
    return $devices if !grep { $_->{online} } @$devices;

    my @state = network_state();
    for my $dev (@$devices) {
        next if !$dev->{online};
        my $reason = in_use_reason($dev, @state);
        $dev->{'in-use'} = $reason if defined($reason);
    }
    return $devices;
}

# Set the online qeth device $device (group ID or read device) offline, persistently ('chzdev -d':
# its network interface goes away). Refuses devices that lszdev does not list as qeth devices,
# devices that are offline already and devices the node uses (see in_use_reason()).
sub disable {
    my ($device) = @_;

    die "invalid qeth device '$device'\n"
        if $device !~ m/^(?:$GROUP_RE|$BUSID_RE)$/i;

    my $dev = find_device(list_devices(), $device)
        or die "'$device' is no qeth device of this node\n";
    die "qeth device $dev->{id} is offline already\n" if !$dev->{online};
    if (my $reason = in_use_reason($dev, network_state())) {
        die "qeth device $dev->{id} cannot be set offline: $reason\n";
    }

    my $errors = '';
    eval {
        run_command(
            disable_command($dev),
            outfunc => sub { },
            errfunc => sub { $errors .= "$_[0]\n" },
            timeout => 120,
        );
    };
    if (my $err = $@) {
        $errors =~ s/\s+$//;
        die "setting qeth device $dev->{id} offline failed: "
            . ($errors ne '' ? "$errors\n" : $err);
    }

    return find_device(list_devices(), $dev->{id}) // $dev;
}

1;
