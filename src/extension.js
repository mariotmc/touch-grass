// @ts-check
"use strict";

const vscode = require("vscode");
const { TouchGrassController } = require("./controller");

/** @type {TouchGrassController | undefined} */
let controller;

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  controller = new TouchGrassController(context);
  context.subscriptions.push(controller);

  /** @param {string} id @param {(...args: any[]) => any} fn */
  const register = (id, fn) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  register("touchGrass.takeBreakNow", () => controller?.takeBreakNow());
  register("touchGrass.postpone", () => controller?.postpone());
  register("touchGrass.skip", () => controller?.skipBreak());
  register("touchGrass.reset", () => controller?.resetTimer());
  register("touchGrass.togglePause", () => controller?.togglePause());
  register("touchGrass.openMenu", () => controller?.openMenu());

  controller.init();
}

function deactivate() {
  controller?.dispose();
  controller = undefined;
}

module.exports = { activate, deactivate };
