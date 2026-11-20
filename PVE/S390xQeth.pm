package PVE::S390xQeth;

# The qeth network devices (OSA-Express, HiperSockets) of an s390x node: CCW group devices of a
# read, a write and a data subchannel. Linux only creates a network interface for one once it is
# set online, which the s390-tools zdev tools do: 'lszdev qeth' lists the qeth devices the node
# can use (with the groups auto-detected from the subchannels of a CHPID), 'chzdev -e qeth <id>'
# sets one online, now and persistently (udev rules in /etc/udev/rules.d).
#
# Only qeth devices: lszdev lists the devices of one type, so FCP and DASD devices (which may carry
# the root file system of the node) never show up here, and enable() only takes a device lszdev
# lists as a qeth device that is offline.

use strict;
use warnings;

use PVE::Tools qw(run_command);

our $LSZDEV = '/usr/sbin/lszdev';
our $CHZDEV = '/usr/sbin/chzdev';

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

1;
