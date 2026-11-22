'use strict';
const {app,BrowserWindow,session,shell}=require('electron');
const path=require('node:path');
app.setAppUserModelId('com.chefmargin.portable');
function createWindow(){
  const win=new BrowserWindow({width:1260,height:850,minWidth:700,minHeight:530,title:'ChefMargin — Food Cost Studio',backgroundColor:'#0b1420',autoHideMenuBar:true,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true}});
  win.webContents.setWindowOpenHandler(({url})=>{if(/^https:\/\//.test(url))shell.openExternal(url);return {action:'deny'};});
  win.loadFile(path.join(__dirname,'..','web','index.html'));
  win.once('ready-to-show',()=>win.show());
}
app.whenReady().then(()=>{session.defaultSession.on('will-download',(event,item)=>{item.setSaveDialogOptions({title:'Save ChefMargin file',defaultPath:item.getFilename()});});createWindow();app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
