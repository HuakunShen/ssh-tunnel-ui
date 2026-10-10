//! Binary entry for the ssh-tunnel desktop shell.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ssh_tunnel_desktop::run();
}
