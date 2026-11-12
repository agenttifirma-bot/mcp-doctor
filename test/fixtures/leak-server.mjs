// Testipalvelin: tulostaa saamansa API_TOKEN-arvon stderriin ja kaatuu (kuin "virheellinen avain" -viesti).
process.stderr.write(`virheellinen avain: ${process.env.API_TOKEN ?? "(puuttuu)"}\n`);
process.exit(3);
