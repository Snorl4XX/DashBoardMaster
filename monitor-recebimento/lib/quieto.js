'use strict';
/** Esconde só o aviso "SQLite is an experimental feature" do Node (o SQLite embutido funciona normalmente). */
if (!process.__recebimentoQuieto) {
  process.__recebimentoQuieto = true;
  const emitir = process.emitWarning;
  process.emitWarning = function (aviso) {
    if (/SQLite is an experimental feature/i.test(String((aviso && aviso.message) || aviso))) return;
    return emitir.apply(process, arguments);
  };
}
