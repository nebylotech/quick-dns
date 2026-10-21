import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

const QuickSettingsMenu = Main.panel.statusArea.quickSettings;

const DNS_PRESETS = [
    { id: 'cloudflare',  name: 'Cloudflare',         dns: ['1.1.1.1', '1.0.0.1'] },
    { id: 'google',      name: 'Google',             dns: ['8.8.8.8', '8.8.4.4'] },
    { id: 'quad9',       name: 'Quad9',              dns: ['9.9.9.9', '149.112.112.112'] },
    { id: 'adguard',     name: 'AdGuard',             dns: ['94.140.14.14', '94.140.15.15'] },
    { id: 'malwlink',    name: 'Malw.link',           dns: ['84.21.189.133', '193.23.209.189'] },
    { id: 'xbox',        name: 'Xbox DNS',            dns: ['111.88.96.50', '111.88.96.51'] },
    { id: 'comssone',    name: 'Comss.one',           dns: ['83.220.169.155', '212.109.195.93'] },
];

const TEXT = {
    en: {
        'Select DNS server': 'Select DNS server',
        'Custom DNS': 'Custom DNS',
        'Test ping': 'Test ping',
        'Pinging...': 'Pinging...',
        'Disabled': 'Disabled',
        'No active network connection found': 'No active network connection found',
        'No connection': 'No connection',
        'Applying %s...': 'Applying %s...',
        'Permission denied': 'Permission denied',
        'Failed to set DNS. Try: sudo nmcli con mod "%s" ipv4.dns "%s"':
            'Failed to set DNS. Try: sudo nmcli con mod "%s" ipv4.dns "%s"',
        'Resetting DNS...': 'Resetting DNS...',
        'Auto (DHCP)': 'Auto (DHCP)',
        '%s\n%s': '%s\n%s',
        'Failed to reset DNS. Try: sudo nmcli con mod "%s" ipv4.ignore-auto-dns no ipv4.dns ""':
            'Failed to reset DNS. Try: sudo nmcli con mod "%s" ipv4.ignore-auto-dns no ipv4.dns ""',
        'Invalid custom IPv4 DNS address': 'Enter a valid custom IPv4 DNS address',
        'Quick DNS — Ping': 'Quick DNS — Ping',
    },
    ru: {
        'Select DNS server': 'Выберите DNS-сервер',
        'Custom DNS': 'Свой DNS',
        'Test ping': 'Проверить пинг',
        'Pinging...': 'Пингую...',
        'Disabled': 'Выключено',
        'No active network connection found': 'Активное сетевое подключение не найдено',
        'No connection': 'Нет подключения',
        'Applying %s...': 'Применение %s...',
        'Permission denied': 'Недостаточно прав',
        'Failed to set DNS. Try: sudo nmcli con mod "%s" ipv4.dns "%s"':
            'Не удалось установить DNS. Попробуйте: sudo nmcli con mod "%s" ipv4.dns "%s"',
        'Resetting DNS...': 'Сброс DNS...',
        'Auto (DHCP)': 'Авто (DHCP)',
        '%s\n%s': '%s\n%s',
        'Failed to reset DNS. Try: sudo nmcli con mod "%s" ipv4.ignore-auto-dns no ipv4.dns ""':
            'Не удалось сбросить DNS. Попробуйте: sudo nmcli con mod "%s" ipv4.ignore-auto-dns no ipv4.dns ""',
        'Invalid custom IPv4 DNS address': 'Введите корректный IPv4-адрес собственного DNS',
        'Quick DNS — Ping': 'Quick DNS — Ping',
    },
};

function text(language, key, ...values) {
    let result = TEXT[language]?.[key] ?? TEXT.en[key] ?? key;
    for (const value of values)
        result = result.replace('%s', value);
    return result;
}

function getCustomPreset(settings) {
    return {
        id: 'custom',
        name: text(settings.get_string('language'), 'Custom DNS'),
        dns: settings.get_strv('custom-dns-servers').map(address => address.trim()).filter(Boolean),
    };
}

function pingHost(host) {
    return new Promise((resolve) => {
        try {
            const proc = Gio.Subprocess.new(
                ['ping', '-c', '1', '-W', '2', host],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            proc.communicate_utf8_async(null, null, (proc, res) => {
                try {
                    const [, stdout] = proc.communicate_utf8_finish(res);
                    const match = stdout.match(/time=(\d+\.?\d*)\s*ms/);
                    resolve(match ? parseFloat(match[1]) : null);
                } catch {
                    resolve(null);
                }
            });
        } catch {
            resolve(null);
        }
    });
}

function getActiveConnection() {
    return new Promise((resolve) => {
        try {
            const proc = Gio.Subprocess.new(
                ['nmcli', '-t', '-f', 'NAME,DEVICE', 'con', 'show', '--active'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            proc.communicate_utf8_async(null, null, (proc, res) => {
                try {
                    const [, stdout] = proc.communicate_utf8_finish(res);
                    const lines = stdout.trim().split('\n');
                    for (const line of lines) {
                        const [name, device] = line.split(':');
                        if (name && device && !['lo', 'docker0'].some(x => name.startsWith(x))) {
                            resolve({ name, device });
                            return;
                        }
                    }
                    resolve(null);
                } catch {
                    resolve(null);
                }
            });
        } catch {
            resolve(null);
        }
    });
}

function runCommands(commands) {
    return new Promise((resolve) => {
        function next(index) {
            if (index >= commands.length) {
                resolve(true);
                return;
            }
            try {
                const proc = Gio.Subprocess.new(
                    commands[index],
                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
                );
                proc.communicate_utf8_async(null, null, (proc, res) => {
                    try {
                        const [, , stderr] = proc.communicate_utf8_finish(res);
                        if (proc.get_successful()) {
                            next(index + 1);
                        } else {
                            console.warn(`[QuickDNS] Failed: ${commands[index].join(' ')}`, stderr?.trim());
                            resolve(false);
                        }
                    } catch (e) {
                        console.warn(`[QuickDNS] Exception: ${commands[index].join(' ')}`, String(e));
                        resolve(false);
                    }
                });
            } catch (e) {
                console.warn(`[QuickDNS] Subprocess error: ${commands[index].join(' ')}`, String(e));
                resolve(false);
            }
        }
        next(0);
    });
}

function nmcliSetDNS(connection, device, dnsAddresses) {
    return runCommands([
        ['nmcli', 'con', 'mod', connection, 'ipv4.dns', dnsAddresses.join(' ')],
        ['nmcli', 'con', 'mod', connection, 'ipv4.ignore-auto-dns', 'yes'],
        ['nmcli', 'device', 'reapply', device],
    ]);
}

function nmcliResetDNS(connection, device) {
    return runCommands([
        ['nmcli', 'con', 'mod', connection, 'ipv4.ignore-auto-dns', 'no'],
        ['nmcli', 'con', 'mod', connection, 'ipv4.dns', ''],
        ['nmcli', 'device', 'reapply', device],
    ]);
}

const QuickDnsToggle = GObject.registerClass({
    Signals: { 'preset-selected': { param_types: [GObject.TYPE_STRING] } },
}, class QuickDnsToggle extends QuickSettings.QuickMenuToggle {
    _init(iconPath, settings) {
        super._init({
            title: _('Quick DNS'),
            toggleMode: true,
        });

        this._settings = settings;
        this._iconPath = iconPath;
        this._language = settings.get_string('language');
        this._icons = {};
        this._menuItems = new Map();

        const icon = Gio.FileIcon.new(Gio.File.new_for_path(iconPath));
        this.menu.setHeader(icon, _('Quick DNS'), text(this._language, 'Select DNS server'));

        this._itemsSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._itemsSection);

        for (const preset of [...DNS_PRESETS, getCustomPreset(settings)]) {
            const item = new PopupMenu.PopupMenuItem(preset.name);
            item.connect('activate', () => {
                this.emit('preset-selected', preset.id);
            });
            this._menuItems.set(preset.id, item);
            this._itemsSection.addMenuItem(item);
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._pingItem = new PopupMenu.PopupMenuItem(text(this._language, 'Test ping'));
        this._pingItem.connect('activate', () => {
            this._pingItem.setSensitive(false);
            this._pingItem.label.text = text(this._language, 'Pinging...');

            const promises = [...DNS_PRESETS, getCustomPreset(this._settings)].map(async (preset) => {
                const ping = await pingHost(preset.dns[0]);
                return { name: preset.name, ping };
            });

            Promise.all(promises).then((results) => {
                this._pingItem.setSensitive(true);
                this._pingItem.label.text = text(this._language, 'Test ping');

                let msg = '';
                for (const r of results) {
                    const status = r.ping !== null ? `${r.ping}ms` : '✗';
                    msg += `${r.name}: ${status}\n`;
                }
                Main.notify(text(this._language, 'Quick DNS — Ping'), msg.trim());
            });
        });
        this.menu.addMenuItem(this._pingItem);

        this._statusLabel = new PopupMenu.PopupMenuItem('');
        this._statusLabel.reactive = false;
        this.menu.addMenuItem(this._statusLabel);
    }

    setActivePreset(id) {
        this._activePreset = id;
        for (const [presetId, item] of this._menuItems) {
            item.setOrnament(presetId === id
                ? PopupMenu.Ornament.DOT
                : PopupMenu.Ornament.NONE);
        }
    }

    setLanguage(language) {
        this._language = language;
        this.menu.setHeader(
            Gio.FileIcon.new(Gio.File.new_for_path(this._iconPath)),
            _('Quick DNS'),
            text(language, 'Select DNS server')
        );
        this._pingItem.label.text = text(language, 'Test ping');
        this.updateCustomPreset();
        if (this._activePreset === 'custom' && this._statusValues.length > 0)
            this._statusValues[0] = text(language, 'Custom DNS');
        this.setStatus(this._statusKey, ...this._statusValues);
    }

    setStatus(key, ...values) {
        this._statusKey = key;
        this._statusValues = values;
        this._statusLabel.label.text = text(this._language, key, ...values);
    }

    updateCustomPreset() {
        const preset = getCustomPreset(this._settings);
        const item = this._menuItems.get('custom');
        item.label.text = preset.name;
        return preset;
    }
});

const QuickDnsIndicator = GObject.registerClass(
class QuickDnsIndicator extends QuickSettings.SystemIndicator {
    _init(iconPath) {
        super._init();

        this._indicator = this._addIndicator();
        this._indicator.gicon = Gio.FileIcon.new(Gio.File.new_for_path(iconPath));
        this._indicator.reactive = true;
    }
});

export default class QuickDnsExtension extends Extension {
    enable() {
        const iconPath = `${this.path}/icons/quickdns-symbolic.svg`;

        this._settings = this.getSettings();
        if (!this._settings.get_boolean('custom-dns-migrated')) {
            const currentAddresses = this._settings.get_strv('custom-dns-servers');
            const legacyAddresses = [
                this._settings.get_string('custom-dns1'),
                this._settings.get_string('custom-dns2'),
            ].map(address => address.trim()).filter(Boolean);
            if (currentAddresses.length === 2 &&
                currentAddresses[0] === '1.1.1.1' &&
                currentAddresses[1] === '1.0.0.1')
                this._settings.set_strv('custom-dns-servers', legacyAddresses);
            this._settings.set_boolean('custom-dns-migrated', true);
        }
        this._indicator = new QuickDnsIndicator(iconPath);
        this._toggle = new QuickDnsToggle(iconPath, this._settings);

        this._indicator.quickSettingsItems.push(this._toggle);
        QuickSettingsMenu.addExternalIndicator(this._indicator);

        this._state = { enabled: false, preset: 'cloudflare' };

        this._toggle.setActivePreset(this._state.preset);
        this._toggle.setStatus('Disabled');

        this._toggle.connect('preset-selected', (t, id) => {
            this._state.preset = id;
            this._toggle.setActivePreset(id);
            if (!this._state.enabled) {
                this._state.enabled = true;
                this._toggle.checked = true;
            }
            this._applyDNS();
        });

        this._toggle.connect('clicked', () => {
            this._state.enabled = this._toggle.checked;
            this._applyDNS();
        });

        this._settingsSignals = [
            this._settings.connect('changed::language', () => {
                this._toggle.setLanguage(this._settings.get_string('language'));
                if (!this._state.enabled)
                    this._toggle.setStatus('Disabled');
            }),
            this._settings.connect('changed::custom-dns-servers', () => this._customDNSChanged()),
        ];
    }

    disable() {
        for (const signal of this._settingsSignals)
            this._settings.disconnect(signal);
        this._settingsSignals = [];
        this._settings = null;

        this._toggle.destroy();
        this._toggle = null;

        this._indicator.destroy();
        this._indicator = null;
    }

    async _applyDNS() {
        const language = this._settings.get_string('language');
        const conn = await getActiveConnection();
        if (!conn) {
            Main.notify(_('Quick DNS'), text(language, 'No active network connection found'));
            this._toggle.setStatus('No connection');
            return;
        }

        if (this._state.enabled) {
            const preset = this._state.preset === 'custom'
                ? getCustomPreset(this._settings)
                : DNS_PRESETS.find(p => p.id === this._state.preset);
            const dnsAddresses = preset.dns;
            if (dnsAddresses.length === 0 ||
                dnsAddresses.some(address => {
                    const inetAddress = Gio.InetAddress.new_from_string(address);
                    return !inetAddress || inetAddress.get_family() !== Gio.SocketFamily.IPV4;
                })) {
                this._toggle.setStatus('Invalid custom IPv4 DNS address');
                Main.notify(_('Quick DNS'), text(language, 'Invalid custom IPv4 DNS address'));
                return;
            }

            this._toggle.setStatus('Applying %s...', preset.name);
            const ok = await nmcliSetDNS(conn.name, conn.device, dnsAddresses);
            if (ok) {
                this._toggle.setStatus(
                    '%s\n%s',
                    preset.name,
                    dnsAddresses.join(', ')
                );
            } else {
                this._toggle.setStatus('Permission denied');
                Main.notify(
                    _('Quick DNS'),
                    text(
                        language,
                        'Failed to set DNS. Try: sudo nmcli con mod "%s" ipv4.dns "%s"',
                        conn.name,
                        dnsAddresses.join(' ')
                    )
                );
            }
        } else {
            this._toggle.setStatus('Resetting DNS...');
            const ok = await nmcliResetDNS(conn.name, conn.device);
            if (ok) {
                this._toggle.setStatus('Auto (DHCP)');
            } else {
                this._toggle.setStatus('Permission denied');
                Main.notify(
                    _('Quick DNS'),
                    text(
                        language,
                        'Failed to reset DNS. Try: sudo nmcli con mod "%s" ipv4.ignore-auto-dns no ipv4.dns ""',
                        conn.name
                    )
                );
            }
        }
    }

    _customDNSChanged() {
        this._toggle.updateCustomPreset();
    }
}
