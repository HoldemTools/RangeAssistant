const { app, BrowserWindow, screen, Menu, shell, dialog } = require("electron");
const isDev = require("electron-is-dev");
const path = require("path");
const defaultMenu = require(path.join(__dirname, "./menu.js"));
const fs = require("fs");
const util = require("util");
const Ajv = require("ajv");

const width = 330;
const height = 426;

const PROD_URL = "https://rangeassistant.holdem.tools";
const DEV_URL = "http://localhost:3001";
const BUILDER_URL = isDev ? DEV_URL : PROD_URL;

const readFile = util.promisify(fs.readFile);

let appWindows = [];
let primaryDisplay;
let dialogShown = false;

const commonWindowOptions = {
  resizable: false,
  transparent: false,
  hasShadow: true,
  backgroundColor: "#ffffff",
  fullscreenable: false,
  alwaysOnTop: true,
  maximizable: false,
  minimizable: true,
  title: "Range Assistant",
  webPreferences: {
    devTools: isDev,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    enableRemoteModule: false,
    contextIsolation: true,
    preload: path.join(__dirname, "preload.js"),
  },
};

function createAppWindow() {
  let win = new BrowserWindow({
    ...commonWindowOptions,
    width,
    height,
    minWidth: width,
    minHeight: height,
  });
  if (isDev) {
    win.loadURL(`http://localhost:3000/`);
  } else {
    win.loadFile(path.join(__dirname, "../build/index.html"));
  }
  appWindows.push(win);
  const idx = appWindows.length - 1;

  win.on("closed", () => {
    win = null;
    delete appWindows[idx];
  });
  // see https://github.com/electron/electron/issues/20618 and https://github.com/electron/electron/issues/1336
  // win.setAspectRatio(1, {width: 0, height: 74});

  win.webContents.on("new-window", handleOpenWindow);
  win.webContents.on("will-navigate", handleOpenWindow);
  if (isDev) {
    win.webContents.openDevTools({ mode: "detach" });
  }
}

const validateRange = (range) => {
  const ajv = new Ajv();
  if (!ajv.validate(require("./range.schema.json"), range))
    throw new Error(`Invalid range: ${ajv.errorsText()}`);
};

const handleRange = async (fp) => {
  try {
    const data = await readFile(fp, "utf8");
    const range = JSON.parse(data);
    validateRange(range);
    appWindows.forEach((win) => {
      win.webContents.send("add-range", range);
    });
  } catch (err) {
    console.debug(err);
    await dialog.showMessageBox(null, {
      message: "Invalid Range File",
      detail:
        "The range file is not valid. Please try re-exporting the range file from the range builder",
    });
  }
};

const showOpenFileDialog = async () => {
  if (!dialogShown) {
    try {
      dialogShown = true;
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: "Launch Range Assistant",
        message: "Select a Range",
        buttonLabel: "Open Range(s)",
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Range Files", extensions: ["range"] }],
      });
      if (!canceled) {
        filePaths.forEach(handleRange);
      }
    } finally {
      dialogShown = false;
    }
  }
};

app.on("open-file", (event, fp) => {
  handleRange(fp);
});

const resetWindowPositions = () => {
  appWindows.forEach((win) => win.setPosition(0, 0));
};

const setMenu = (enableImport) => {
  const menu = defaultMenu(
    app,
    shell,
    enableImport,
    showOpenFileDialog,
    createAppWindow
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
};

app.on("ready", () => {
  // handle display changes
  const handleWindowChange = () => {
    const newPrimary = screen.getPrimaryDisplay();
    if (newPrimary.id !== primaryDisplay.id) {
      primaryDisplay = newPrimary;
      resetWindowPositions();
    }
  };
  screen.on("display-added", handleWindowChange);
  screen.on("display-removed", handleWindowChange);
  primaryDisplay = screen.getPrimaryDisplay();
  createAppWindow();
});

app.on("window-all-closed", () => {
  setMenu(false);
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (appWindows.length === 0) {
    createAppWindow();
  }
});

app.on("browser-window-focus", () => {
  appWindows.forEach((win) => win.setOpacity(1));
});

app.on("browser-window-blur", () => {
  appWindows.forEach((win) => win.setOpacity(0.3));
});

app.on("browser-window-created", () => {
  setMenu(true);
});

const handleOpenWindow = (event, url) => {
  event.preventDefault();
  if (url.startsWith(PROD_URL)) {
    shell.openExternal(BUILDER_URL);
  }
};

app.on("web-contents-created", (event, contents) => {
  contents.on("will-attach-webview", (event, webPreferences, params) => {
    // Strip away preload scripts if unused or verify their location is legitimate
    if (webPreferences !== commonWindowOptions.webPreferences) {
      event.preventDefault();
      return;
    }
  });
});

if (isDev) {
  require("electron-reload")(__dirname, {
    // Note that the path to electron may vary according to the main file
    electron: require(`${__dirname}/../node_modules/electron`),
  });
}
