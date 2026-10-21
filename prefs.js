import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class QuickDnsPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        if (!settings.get_boolean('custom-dns-migrated')) {
            const currentAddresses = settings.get_strv('custom-dns-servers');
            if (currentAddresses.length === 2 &&
                currentAddresses[0] === '1.1.1.1' &&
                currentAddresses[1] === '1.0.0.1') {
                const legacyAddresses = [
                    settings.get_string('custom-dns1'),
                    settings.get_string('custom-dns2'),
                ].map(address => address.trim()).filter(Boolean);
                settings.set_strv('custom-dns-servers', legacyAddresses);
            }
            settings.set_boolean('custom-dns-migrated', true);
        }
        const page = new Adw.PreferencesPage();

        const generalGroup = new Adw.PreferencesGroup({
            title: 'General',
        });
        const languageRow = new Adw.ComboRow({
            title: 'Language',
            model: Gtk.StringList.new(['English', 'Русский']),
            selected: settings.get_string('language') === 'ru' ? 1 : 0,
        });
        languageRow.connect('notify::selected', () => {
            settings.set_string('language', languageRow.selected === 1 ? 'ru' : 'en');
        });
        generalGroup.add(languageRow);
        page.add(generalGroup);

        const dnsGroup = new Adw.PreferencesGroup({
            title: 'Custom DNS',
            description: 'Add one or more IPv4 addresses used by the Custom DNS menu item.',
        });
        const addresses = settings.get_strv('custom-dns-servers');
        const dnsRows = [];
        const saveAddresses = () => settings.set_strv('custom-dns-servers', addresses);
        const renderDNSRows = () => {
            for (const row of dnsRows)
                dnsGroup.remove(row);
            dnsRows.length = 0;

            addresses.forEach((address, index) => {
                const row = new Adw.EntryRow({
                    title: `IPv4 DNS server ${index + 1}`,
                    text: address,
                });
                row.connect('changed', () => {
                    addresses[index] = row.text;
                    saveAddresses();
                });

                const removeButton = new Gtk.Button({
                    icon_name: 'list-remove-symbolic',
                    valign: Gtk.Align.CENTER,
                    tooltip_text: 'Remove DNS server',
                });
                removeButton.connect('clicked', () => {
                    addresses.splice(index, 1);
                    saveAddresses();
                    renderDNSRows();
                });
                row.add_suffix(removeButton);

                dnsGroup.add(row);
                dnsRows.push(row);
            });
        };
        renderDNSRows();

        const addRow = new Adw.ActionRow({ title: 'Add DNS server' });
        const addButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: 'Add DNS server',
        });
        addButton.connect('clicked', () => {
            addresses.push('');
            saveAddresses();
            renderDNSRows();
        });
        addRow.add_suffix(addButton);
        dnsGroup.add(addRow);
        page.add(dnsGroup);

        window.add(page);
    }
}
