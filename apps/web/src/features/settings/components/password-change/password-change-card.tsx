import {SettingsGroup, SettingsList, SettingsRow} from '../settings-group';
import {PasswordChangeDialog} from './password-change-dialog';

export function PasswordChangeCard() {
  return (
    <SettingsGroup id='sign-in-heading' title='Sign-in'>
      <SettingsList>
        <SettingsRow label='Password' action={<PasswordChangeDialog />} />
      </SettingsList>
    </SettingsGroup>
  );
}
