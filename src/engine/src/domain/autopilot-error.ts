export interface AutopilotErrorHelp { meaning: string; action: string; retryMayHelp: boolean }

/** Fixed explanations only. No model, payload parsing, persistence or guessed root cause. */
export function explainAutopilotError(message: string): AutopilotErrorHelp {
  if (/lease|blocco.*GitHub|lock GitHub|altro dispositivo|altra scheda/i.test(message)) return {
    meaning: "Non è stato possibile confermare il blocco che impedisce a due dispositivi di scrivere insieme. Non significa da solo che un altro browser sia attivo.",
    action: "Apri Archivio e verifica il blocco GitHub. Controlla PAT, regole dei rami e connessione; non forzare il recupero di un blocco attivo.", retryMayHelp: false,
  };
  if (/HTTP (401|403|404)|API key|chiave API|non configurato/i.test(message)) return {
    meaning: "Il servizio o la configurazione non consentono la richiesta. Ripetere lo stesso tentativo non corregge chiavi, permessi o indirizzi.",
    action: "Controlla endpoint, modello e credenziale nelle Impostazioni prima di riprendere.", retryMayHelp: false,
  };
  if (/budget|contesto|troppo (grande|lungo)|quota|memoria.*limite/i.test(message)) return {
    meaning: "Un limite di spesa, contesto o spazio impedisce di proseguire in sicurezza.",
    action: "Controlla il limite indicato prima di riprendere: i tentativi automatici non lo rimuovono.", retryMayHelp: false,
  };
  if (/Remediation non autorizzata: prova narrativa legacy|Checkpoint di remediation: prova narrativa della prossima scena/i.test(message)) return {
    meaning: "Il testo citato dal rilievo non coincide più con la prosa del segmento che deve essere corretto. Per sicurezza la correzione non viene applicata e non si perde il testo già approvato in precedenza.",
    action: "Controlla il checkpoint dal pannello Redazione. Se il messaggio riguarda una scena già corretta, aggiorna il client: il gate non deve rivalidarla. Se riguarda invece la scena successiva, serve una nuova review supervisiva di quel capitolo; non riabilitare il passo forzando la prova.", retryMayHelp: false,
  };
  if (/Prova narrativa non presente|citazione.*(letteral|segmento)|revisore ha citato una scena/i.test(message)) return {
    meaning: "Il revisore ha citato una frase che non coincide con il segmento affidato a lui. Il rapporto è stato scartato: questo tentativo non ha modificato il libro.",
    action: "Puoi riprovare lo stesso task. Con i tentativi automatici attivi, il nuovo prompt spiega lo scarto e chiede di copiare la citazione esatta. Se continua, scegli un modello diverso.", retryMayHelp: true,
  };
  if (/JSON|formato richiesto|schema/i.test(message)) return {
    meaning: "La risposta del modello non ha il formato necessario. Non viene applicata parzialmente al libro.",
    action: "Puoi riprovare; al tentativo automatico comunichiamo il motivo dello scarto, senza indebolire i controlli.", retryMayHelp: true,
  };
  return {
    meaning: "Il task non ha prodotto un risultato applicabile. Non è possibile stabilire la causa precisa dal solo messaggio.",
    action: "Apri il task nelle Attività per i dettagli. Puoi riprovare o cambiare modello: ogni richiesta già inviata può essere addebitata, anche se fallisce.", retryMayHelp: true,
  };
}
