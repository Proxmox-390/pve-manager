#!/usr/bin/perl

use v5.36;

use lib ('.', '..');

use Test::More;

use PVE::Tools qw(file_get_contents);
use PVE::S390xSysinfo;

# /proc/sysinfo samples:
#   lpar.txt        Linux in an LPAR of a z14 ZR1 (serial number anonymised)
#   kvm.txt         KVM guest (s390-ccw-virtio, -name pve-kvm) on that LPAR
#   zvm.txt         z/VM guest in a shared LPAR, after the format of arch/s390/kernel/sysinfo.c
#   kvm-in-zvm.txt  KVM guest in that z/VM guest: VM00 is the innermost level
#   tcg.txt         QEMU TCG, after target/s390x/tcg/misc_helper.c
my $host = {
    manufacturer => 'IBM',
    type => '3907',
    model => 'ZR1',
    plant => '02',
    'sequence-code' => '0000000000012345',
    serial => '12345',
};

my $tests = {
    'lpar.txt' => {
        %$host,
        environment => 'lpar',
        'lpar-number' => 1,
        'lpar-name' => 'LPAR01',
    },
    'kvm.txt' => {
        %$host,
        environment => 'kvm',
        'lpar-number' => 1,
        'lpar-name' => 'LPAR01',
        hypervisor => 'KVM/Linux',
        'guest-name' => 'pve-kvm',
    },
    'zvm.txt' => {
        %$host,
        environment => 'zvm',
        'lpar-number' => 2,
        'lpar-name' => 'LPAR02',
        hypervisor => 'z/VM 7.4.0',
        'guest-name' => 'LINUX01',
    },
    'kvm-in-zvm.txt' => {
        %$host,
        environment => 'kvm',
        'lpar-number' => 2,
        'lpar-name' => 'LPAR02',
        hypervisor => 'KVM/Linux',
        'guest-name' => 'pve1',
    },
    'tcg.txt' => {
        manufacturer => 'QEMU',
        type => '3906',
        model => 'QEMU',
        plant => 'QEMU',
        'sequence-code' => 'QEMU',
        serial => 'QEMU',
        environment => 'kvm',
        'lpar-number' => 0,
        'lpar-name' => 'QEMU',
        hypervisor => 'KVM/Linux',
        'guest-name' => 'tcg-guest',
    },
};

for my $file (sort keys %$tests) {
    my $text = file_get_contents("s390x-sysinfo/$file");
    is_deeply(PVE::S390xSysinfo::parse($text), $tests->{$file}, $file);
}

is(PVE::S390xSysinfo::parse(undef), undef, 'no /proc/sysinfo');
is(PVE::S390xSysinfo::parse(''), undef, 'empty /proc/sysinfo');

is_deeply(
    PVE::S390xSysinfo::parse("Manufacturer:         IBM             \n"
            . "Type:                 2964\n"
            . "Model:                N30             \n"
            . "Sequence Code:        0000000000000000\n"),
    {
        manufacturer => 'IBM',
        type => '2964',
        model => 'N30',
        'sequence-code' => '0000000000000000',
    },
    'no model field, all-zero sequence code, no LPAR level',
);

done_testing();
