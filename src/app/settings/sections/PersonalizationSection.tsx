'use client';

import SettingsSection from '../components/SettingsSection';
import InputComponent from '../components/InputComponent';
import TextareaComponent from '../components/TextareaComponent';

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
        <p className="text-xs text-fg/60">
          Saved locally in your browser. You can choose to send this info per
          message.
        </p>
        <div className="flex flex-col space-y-4">
          <div className="flex flex-col space-y-2">
            <label
              className="text-sm font-medium"
              htmlFor="personalization-location"
            >
              Location
            </label>
            <InputComponent
              id="personalization-location"
              type="text"
              value={location}
              placeholder="Seattle, WA or Greater Chicago Area"
              onChange={(e) => onChange('location', e.target.value)}
            />
          </div>

          <div className="flex flex-col space-y-2">
            <label
              className="text-sm font-medium"
              htmlFor="personalization-about"
            >
              About Me
            </label>
            <TextareaComponent
              id="personalization-about"
              value={about}
              placeholder="I am a YouTube travel vlogger who enjoys playing video games in my spare time. I have a wife, two kids, and one dog."
              onChange={(e) => onChange('about', e.target.value)}
            />
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}
