'use client';

import SettingsSection from '../components/SettingsSection';
import InputComponent from '../components/InputComponent';
import TextareaComponent from '../components/TextareaComponent';
import { Field } from '@/components/ui/Field';

export default function PersonalizationSection({
  location,
  about,
  onChange,
}: {
  location: string;
  about: string;
  onChange: (field: 'location' | 'about', value: string) => void;
}) {
  return (
    <div id="personalization">
      <SettingsSection title="Personalization">
        <p className="text-xs text-fg-muted">
          Saved to your account and synced across devices. You can choose to
          send this info per message.
        </p>
        <div className="flex flex-col space-y-4">
          <Field label="Location">
            <InputComponent
              type="text"
              value={location}
              placeholder="Seattle, WA or Greater Chicago Area"
              onChange={(e) => onChange('location', e.target.value)}
            />
          </Field>

          <Field label="About Me">
            <TextareaComponent
              value={about}
              placeholder="I am a YouTube travel vlogger who enjoys playing video games in my spare time. I have a wife, two kids, and one dog."
              onChange={(e) => onChange('about', e.target.value)}
            />
          </Field>
        </div>
      </SettingsSection>
    </div>
  );
}
