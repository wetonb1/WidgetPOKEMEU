' iniciar-widget.vbs - abre o widget (npm start) sem mostrar janela de console.
' Para abrir junto com o Windows: Win+R, digite shell:startup e coloque ali um
' ATALHO para este arquivo (botao direito > Criar atalho, depois mova o atalho).
' A pasta do projeto e descoberta sozinha: o .vbs pode ficar onde esta.
Option Explicit
Dim fso, shell, pasta
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
pasta = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = pasta
' 0 = janela oculta; False = nao espera o widget fechar
shell.Run "cmd /c npm start", 0, False
