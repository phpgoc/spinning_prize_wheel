!macro NSIS_HOOK_PREUNINSTALL
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
    "是否同时删除转盘工具的本地数据？$\r$\n$\r$\n选择‘是’会删除普通版与猜蜜版共用的排名、抽奖历史、排阵历史和本地配置；选择‘否’可在以后重新安装时继续使用。" \
    IDNO keep_wheel_data

  ; 两个版本的排名数据库共用普通版目录，用户明确同意后才一起清理。
  RMDir /r "$APPDATA\com.phpgoc.fortuna"
  RMDir /r "$APPDATA\com.phpgoc.fortuna.caimi"
  RMDir /r "$LOCALAPPDATA\com.phpgoc.fortuna"
  RMDir /r "$LOCALAPPDATA\com.phpgoc.fortuna.caimi"

  keep_wheel_data:
!macroend
