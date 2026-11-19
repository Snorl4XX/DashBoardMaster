'use strict';
/** Esconde só o aviso "SQLite is an experimental feature" do Node (o SQLite embutido funciona normalmente). */
if (!process.__rotaCertaQuieto) {
  process.__rotaCertaQuieto = true;
  const emit = process.emitWarning;
  process.emitWarning = function (warning) {
    if (/SQLite is an experimental feature/i.test(String(warning && warning.message || warning))) return;
    return emit.apply(process, arguments);
  };
}
