'use strict';
/** Esconde só o aviso "SQLite is an experimental feature" do Node (o SQLite embutido funciona normalmente). */
if (!process.__dashmasterQuiet) {
  process.__dashmasterQuiet = true;
  const emit = process.emitWarning;
  process.emitWarning = function (warning) {
    const text = String(warning && warning.message || warning);
    if (/SQLite is an experimental feature/i.test(text)) return;
    return emit.apply(process, arguments);
  };
}
