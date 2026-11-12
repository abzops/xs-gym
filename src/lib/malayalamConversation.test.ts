import { describe, expect, it } from 'vitest';
import { everydayMalayalamReply } from '../../supabase/functions/xs-ai/agent';

describe('XS AI conversational Malayalam', () => {
  it('understands typical spoken can-you-hear-me variants without inventing an action', () => {
    expect(everydayMalayalamReply('ആ ഞാൻ പറയുന്നത് കേൾക്കുന്നുണ്ടോ?', 'ml'))
      .toBe('അതെ, നിങ്ങളുടെ മെസേജ് കിട്ടി. പറയൂ!');
    expect(everydayMalayalamReply('ഞാൻ പറയുന്നതു കേൾക്കാമോ', 'ml'))
      .toBe('അതെ, നിങ്ങളുടെ മെസേജ് കിട്ടി. പറയൂ!');
  });
  it('uses concise natural language for social talk', () => {
    expect(everydayMalayalamReply('സുഖമാണോ താങ്കൾക്ക്', 'ml')).toBe('സുഖം തന്നെ! എന്താ വിശേഷം?');
    expect(everydayMalayalamReply('എന്താണിങ്ങനെ', 'ml')).toContain('ഒന്ന് കൂടി വിശദമാക്കാമോ');
  });
  it('never changes operational questions or English-only questions', () => {
    expect(everydayMalayalamReply('Today revenue?', 'en')).toBeNull();
    expect(everydayMalayalamReply('ഇന്നത്തെ കളക്ഷൻ എത്രയാണ്', 'ml')).toBeNull();
    expect(everydayMalayalamReply('രാഹുലിന്റെ മെമ്പർഷിപ്പ് പുതുക്കൂ', 'ml')).toBeNull();
  });
});
