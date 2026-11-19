package PVE::S390xSysinfo;

# The system identity of an s390x (IBM Z / LinuxONE) node, as the kernel reports it in
# /proc/sysinfo (arch/s390/kernel/sysinfo.c, from the STSI 1.1.1, 2.2.2 and 3.2.2 blocks):
#
#   - the serial number of the machine: the 'Sequence Code' of STSI 1.1.1, with the leading zeros
#     the machine pads it with removed (the same as Ansible's product_serial fact);
#   - the environment the node runs in: the innermost hypervisor level. 'VM00' is the level
#     closest to the node; its 'Control Program' tells z/VM ("z/VM    7.4.0") from KVM
#     ("KVM/Linux"), the same check as systemd-detect-virt and lscpu. Without a VM level, the node
#     runs directly in a logical partition (PR/SM).
#
# A guest of a hypervisor sees the identity of the machine it runs on: KVM and z/VM pass STSI
# 1.1.1 and 2.2.2 through, so a guest reports the serial number and the LPAR of its host.

use strict;
use warnings;

use PVE::Tools qw(file_get_contents);

my sub trim {
    my ($s) = @_;
    return undef if !defined($s);
    $s =~ s/^\s+|\s+$//g;
    return length($s) ? $s : undef;
}

# Parse the contents of /proc/sysinfo. Returns undef if there is no machine identity in it.
sub parse {
    my ($text) = @_;

    return undef if !defined($text);

    my $field = {};
    for my $line (split(/\n/, $text)) {
        my ($key, $value) = $line =~ m/^([^:]+?):\s?(.*)$/ or next;
        $field->{$key} //= $value;
    }

    my $res = {};

    for my $key (qw(manufacturer type plant)) {
        my $value = trim($field->{ucfirst($key)});
        $res->{$key} = $value if defined($value);
    }

    # "Model: <model capacity identifier> <model>", the model is missing on old machines
    if (my $model = trim($field->{Model})) {
        my @words = split(/\s+/, $model);
        $res->{model} = $words[-1];
    }

    if (defined(my $sequence = trim($field->{'Sequence Code'}))) {
        $res->{'sequence-code'} = $sequence;
        (my $serial = $sequence) =~ s/^0+//;
        $res->{serial} = $serial if length($serial);
    }

    if (defined($field->{'LPAR Number'}) && $field->{'LPAR Number'} =~ m/^\s*(\d+)\s*$/) {
        $res->{'lpar-number'} = int($1);
        my $name = trim($field->{'LPAR Name'});
        $res->{'lpar-name'} = $name if defined($name);
    }

    if (defined(my $cp = trim($field->{'VM00 Control Program'}))) {
        $cp =~ s/\s+/ /g;
        $res->{hypervisor} = $cp;
        my $name = trim($field->{'VM00 Name'});
        if ($cp =~ m!^z/VM\b!) {
            $res->{environment} = 'zvm';
            $res->{'guest-name'} = $name if defined($name); # the z/VM user ID
        } else {
            # KVM reports "KVM/Linux", and so does QEMU's TCG; anything else that is not
            # z/VM is taken as KVM as well, as systemd-detect-virt does
            $res->{environment} = 'kvm';
            my $ext_name = trim($field->{'VM00 Extended Name'});
            $name = $ext_name if defined($ext_name);
            $res->{'guest-name'} = $name if defined($name);
        }
    } elsif (defined($res->{'lpar-number'})) {
        $res->{environment} = 'lpar';
    }

    return undef if !%$res;
    return $res;
}

my $cache;

# The identity of the running system, read once per process: none of it changes before a re-IPL.
sub read_sysinfo {
    return $cache if $cache;

    my $text = eval { file_get_contents('/proc/sysinfo') };
    return undef if !defined($text); # not s390x, or no /proc/sysinfo

    $cache = parse($text);
    return $cache;
}

1;
