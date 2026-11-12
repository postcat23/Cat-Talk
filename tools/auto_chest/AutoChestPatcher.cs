// Cat-Talk 게임 패처. 게임 어셈블리(Assembly-CSharp.dll)를 Mono.Cecil로 읽어 훅 다섯 묶음을 함께 넣는다.
// 게임 어셈블리를 로드·실행하지 않는다. 패치 세트 버전: 1 = 상자 자동 오픈만, 2 = 상자 자동 오픈 + 투명화,
//   3 = 상자 자동 오픈 + 투명화 + 차단 멤버 고양이 숨김, 4 = 3 + 투명화 중 내 고양이 획득 팝업 숨김,
//   5 = 4 + 투명화 루트 후크(내 고양이 주변 UI 전체 숨김·열린 게임 메뉴 닫기). 세트는 누적이다(높은 버전은 낮은 버전의 훅을 모두 포함).
// 상자 자동 오픈(D-019): Shop.TimerUpdate 상태머신 MoveNext의 "ChestIsReady = true; OnChestReady();" 직후에
//   "if (File.Exists(<플래그>)) this._shopItem.Buy();"를 삽입한다.
// 투명화(D-028): 고양이마다 하나인 TranslucentOnHover의 알파 경로에 플래그를 건다. 삽입은 여덟 곳이다.
//   SetTranslucentSmooth: 플래그가 있으면 목표 알파 0(타이머·호버 복귀도 이 경로라 함께 막힌다).
//     클릭 통과는 게임 경로 그대로다: 목표 알파가 1이 아니면 게임이 Ignore Raycast 레이어로 바꾸고, 창 판정이 이 레이어를 뺀다.
//   SetLayerRecursively: 투명화 중에는 CanvasGroup 안의 클릭 예외(상점·인벤토리 등)도 레이어를 바꾸고, UI로 복원할 때 함께 되돌린다.
//   Start: 플래그가 있으면 새 고양이를 번쩍임 없이 곧바로 투명하게 한다.
//   TranslucentOnHoverSetting.Update: 0.5초마다 플래그 변화를 보고 OnSetTranslucent로 전체에 알린다.
//   호버 두 곳: 게임 호버 판정은 Ignore Raycast도 호버로 쳐서, 투명한 고양이도 호버 상태가 된다(F·R 키, 가운데 클릭 메뉴, 카운터 옆 버튼).
//     OnUIHoverCallback.IsPointerOverUIElement와 OnSpecificUIHoverCallback의 결과 필터에서 투명화 중에는 레이어 2를 뺀다.
//   팝업 두 곳: 이모트 도넛·말풍선 버튼은 레이캐스트가 아니라 커서 거리로 열린다(실게임 확인). 게임이 반투명 중에 켜는
//     TranslucentOnHoverSetting.DisablePopups를 EmoteDonut.Update와 CatSpeech.Update가 읽는 분기에서, 투명화 중에도 꺼진 쪽으로 보낸다.
// 차단 멤버 고양이 숨김(D-033 3단계): 게임의 멤버별 숨김(LobbyMemberInstance.IsHidden: 고양이 오브젝트를 끄고 자리를 비운다)을 쓴다.
//   목록 파일은 플래그 옆 CatTalkHidden.ids(한 줄에 SteamID64 하나, LF). 없거나 비면 아무도 숨기지 않는다. 앱이 통째로 다시 쓴다.
//   숨김 setter·getter·PlayerDataCache·LobbyMemberVisibility.SetVisibility와 그 호출 대상은 Cat Talk 연결 호환성 지문(업스트림
//   feature-contract.json의 privacy)이 본문까지 본다. 여기를 바꾸면 Cat Talk가 '지원하지 않는 게임 빌드'로 연결을 멈춘다(2026-11-10 실측:
//   setter 입구 훅 시험본). 그래서 지문 범위 밖 세 곳에만 훅을 건다(세 곳 모두 업스트림 FeatureProbe로 지문 불변 실측).
//   LobbyMemberInstance에 정적 필드 둘(적용한 목록, 다음 확인 시각)과 정적 메서드 넷(CatTalkListed·CatTalkHide·CatTalkVisible·CatTalkPoll)을 더한다.
//   훅 ① LobbyMemberInstance.Start의 set_IsHidden 호출 직전: value = CatTalkHide(value, this) — 입장·재입장 때 처음부터 숨김.
//   훅 ② LobbyMemberVisibility.HandleAutoHideUpdated의 SetVisibility 호출 직전: visible = CatTalkVisible(visible, _steamUserData)
//     — 자동 숨김 토글·참여자 목록 행 생성 때 목록에 있는 멤버는 '숨김'으로(게임 버튼 상태도 맞는다).
//   훅 ③ CatSpawnManager.Update 처음: CatTalkPoll() — 0.5초마다 목록 파일을 읽어 전 멤버에 적용한다. 목록에 있는데 보이는 멤버는 숨기고
//     (새로 든 멤버, 게임 참여자 목록의 '보이기'를 직접 누른 경우 — 이 버튼은 지문 범위라 훅을 걸 수 없어 최대 0.5초 보인다),
//     목록에서 빠진 멤버는 게임 '자동 숨김' 설정값으로 되돌린다(D-033 결정 A). 그 밖의 멤버는 건드리지 않는다.
//     파일 읽기·적용은 try/catch 안이다. 실패하면 이번 확인만 건너뛰고(게임 Update는 그대로 진행) 0.5초 뒤 다시 본다.
//   투명화(알파 0)와 독립이다: 숨긴 고양이는 오브젝트가 꺼지고, 나머지 고양이에는 투명화가 그대로다.
// 투명화 중 획득 팝업 숨김(D-046, 세트 4): 내 고양이의 획득 팝업(MainCat/NewItemPopup)은 투명화가 알파를 내리는 CanvasGroup
//   (MainCat/DraggableFrame) 밖의 형제라 투명화 중에도 보였다(씬 실측). 다른 참여자 고양이의 팝업은 그 고양이 CanvasGroup 아래라 이미 숨는다.
//   NewItemPopup.ShowPopup에서 멀티플레이 전송(SteamMultiplayer.SendReceivedItem) 다음, 표시(큐에 넣기·켜기) 앞에
//   "if (CatTalkTransparent) return;"을 넣는다. 전송은 게이트 앞이라 다른 참여자 화면의 내 획득 팝업은 그대로다.
//   상자·교환·프로모·PawPass 등 내 고양이 획득 팝업 전부가 이 메서드를 지난다. 투명화 중 받은 아이템은 큐에 넣지 않는다(끈 뒤 몰아 뜨지 않음).
//   켜는 순간 이미 떠 있던 팝업은 끝까지(약 3초) 둔다. ShowPopup·SendReceivedItem은 Cat Talk 연결 지문 범위 밖이다(업스트림 FeatureProbe 실측).
// 투명화 루트 후크(D-047, 세트 5): 내 고양이 투명화 알파는 게임 호버 반투명의 그룹(MainCat/DraggableFrame)에만 걸려, 그 형제
//   (잠수 Zzz·하트·선물 이모트 파티클, 오류 창, 키 후킹 경고, CatPopUps, 튜토리얼, 이미 뜬 말풍선 등)가 보였다(씬 실측). 로비 고양이는 그룹이 루트라 전부 숨는다.
//   Start 끝(투명화 블록 앞): _alpha가 자기 오브젝트가 아니면(= 내 고양이) 루트(MainCat)에 CanvasGroup을 하나 붙여 CatTalkRoot에 둔다.
//   SetTranslucentSmooth(투명화 블록 다음): 루트 알파 = 목표 알파가 0이면 0, 아니면 1. 게임 목표는 상수 0.1·1이라 0은 투명화 블록만 만든다
//     (게임 호버 반투명은 루트에 영향 없음). 0이면 EmoteDonut.CatTalkCloseMenu()로 열린 게임 메뉴(MenuNew)를 닫는다 — 게임 닫기 버튼과 같은
//     ToggleGameObject.SetActive(false) 경로(OnToggle 포함). 메뉴는 클릭 예외라 레이어가 UI로 남아, 루트 알파만 내리면 안 보이는데 클릭되는 영역이 된다.
//   EmoteDonut에 정적 메서드 하나(CatTalkCloseMenu: _menu가 private이라 그 타입 안에 둔다), TranslucentOnHover에 인스턴스 필드 하나(CatTalkRoot)를 더한다.
//   입력 차단(도넛·말풍선 게이트, 호버 두 곳)과 획득 팝업 게이트는 그대로 둔다 — 알파와 달리 커서 거리·Enter 입력과 큐 적체를 막는다.
//   대상 메서드(TranslucentOnHover·EmoteDonut·ToggleGameObject)는 Cat Talk 연결 지문 범위 밖이다(업스트림 FeatureProbe 대상 목록 실측).
// 게임 런타임 어셈블리는 스트리핑돼 공개 Unity API도 없을 수 있다(실측: CanvasGroup.set_blocksRaycasts 없음).
// 그래서 patch·verify는 결과의 모든 참조를 게임 Managed 폴더에서 해석해 보고, 하나라도 안 되면 거부한다.
// 명령: inspect <dll> | patch <in> <out> <flag> <managedDir> | verify <orig> <patched> <flag> <managedDir>
//       backup <dll> <backupDir> | restore <backupDir> <target>
// <flag>는 상자 자동 오픈 플래그다. 투명화 플래그(CatTalkTransparent.on)와 숨김 목록(CatTalkHidden.ids)은 같은 폴더로 정해지고, 셋은 독립이다.
// 출력은 JSON 한 줄. 종료 코드: 0 성공, 2 호환 안 됨/거부, 3 이미 패치됨(건너뜀), 1 오류.
// C# 5(.NET Framework csc v4)로 빌드한다.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using Mono.Cecil;
using Mono.Cecil.Cil;

sealed class Incompatible : Exception { internal Incompatible(string code) : base(code) { } }

// 대상 구조. 하나라도 없거나 모호하면 Incompatible.
sealed class Target {
    internal TypeDefinition Shop, ShopItem, StateMachine;
    internal FieldDefinition ShopItemField, ChestIsReady, This;
    internal MethodDefinition OnChestReady, Buy, MoveNext;
    internal int AnchorIndex;               // MoveNext에서 앵커(OnChestReady 호출) 명령 위치
    internal List<int> Markers = new List<int>();   // 우리 삽입 마커(ldstr ...CatTalkAutoChest.on) 위치

    internal TypeDefinition Hover, HoverSetting;
    internal FieldDefinition HoverAlpha, LayerUI, OnSetTranslucent, StateField, NextPollField;
    internal MethodDefinition Smooth, Layer, HoverStart, SettingUpdate;
    internal MethodReference InvokeBool, UnscaledTime, GetTransform, IsChildOf;
    internal int SmoothAnchor;              // SetTranslucentSmooth에서 목표 알파를 저장하는 stloc.0 위치
    internal int LayerAnchor;               // SetLayerRecursively에서 클릭 예외면 반환하는 분기(brfalse) 위치
    internal List<int> SmoothMarkers, LayerMarkers, StartMarkers, UpdateMarkers;
    internal MethodDefinition OverUI, HoverFilter;      // 호버 판정, 고양이별 호버 결과 필터
    internal MethodReference ResultGameObject, GetLayer;
    internal int OverUIAnchor;              // IsPointerOverUIElement에서 "Ignore Raycast가 아니면 다음 결과로" 분기(bne.un) 위치
    internal List<int> OverUIMarkers, FilterMarkers;
    internal MethodDefinition DonutUpdate, SpeechUpdate;    // 팝업(이모트 도넛, 말풍선 버튼)
    internal int DonutAnchor, SpeechAnchor;                 // "if (DisablePopups) 숨김"의 brtrue 위치
    internal List<int> DonutMarkers, SpeechMarkers;

    // 차단 멤버 고양이 숨김(D-033 3단계)
    internal TypeDefinition Member, SpawnManager, Visibility;
    internal FieldDefinition SteamUserDataField, VisibilityUserField, Instances, SettingsInstance, AutoHide, HiddenIdsField, HiddenPollField;
    internal MethodDefinition Getter, Setter, MemberStart, SetVisibility, VisibilityToggle, SpawnUpdate, ToggleValue;
    internal MethodDefinition ListedMethod, HideMethod, VisibleMethod, PollMethod;
    internal MethodReference GetData, GetIdStr, Values, ToArrayOpen;
    internal TypeReference UserDataType;
    internal int StartCall, ToggleCall;   // Start의 set_IsHidden 호출, HandleAutoHideUpdated의 SetVisibility 호출 위치(삽입은 그 바로 앞)
    internal List<int> MemberStartMarkers, ToggleMarkers, SpawnMarkers;   // CatTalkHide·CatTalkVisible·CatTalkPoll 호출 위치

    // 투명화 중 획득 팝업 숨김(D-046, 세트 4)
    internal TypeDefinition ItemPopup;
    internal MethodDefinition ShowPopup;
    internal int PopupAt;                     // SendReceivedItem 호출 바로 다음 = 전송 분기가 합쳐지는 곳(게이트 위치)
    internal List<int> ItemPopupMarkers;      // ShowPopup의 ldsfld CatTalkTransparent 위치

    // 투명화 루트 후크(D-047, 세트 5)
    internal TypeDefinition Donut, Toggle;
    internal FieldDefinition DonutMenu, DonutInstance, RootField;
    internal MethodDefinition ToggleSetActive, CloseMenuMethod;
    internal MethodReference OpEquality, OpImplicit, GetGameObject, GoGetComponent, GoSetActive, GoActiveSelf;
    internal List<int> RootStartMarkers, RootSmoothMarkers, CloseMenuCalls;   // stfld CatTalkRoot(Start), ldfld CatTalkRoot(Smooth), CatTalkCloseMenu 호출

    internal const string FlagName = "CatTalkAutoChest.on";
    internal const string TransparentFlagName = "CatTalkTransparent.on";
    internal const string StateFieldName = "CatTalkTransparent";
    internal const string NextPollFieldName = "CatTalkNextPoll";
    internal const float PollSeconds = 0.5f;
    internal const int SmoothInsert = 5, LayerInsert = 12, StartInsert = 10, UpdateInsert = 22;   // 삽입 명령 수
    internal const int SmoothMarkerAt = 0, UpdateMarkerAt = 7;                  // 삽입 블록 안의 ldstr 위치
    internal const int LayerMarkerAt = 6;                                       // 레이어 블록 안의 ldsfld CatTalkTransparent 위치
    internal const int OverUIInsert = 2, FilterInsert = 9, PopupInsert = 2;     // 호버·팝업 블록(마커 = 첫 명령 ldsfld CatTalkTransparent)
    internal const int IgnoreRaycastLayer = 2;                                  // Unity 고정 레이어. 게임 클릭 판정도 상수 2를 쓴다
    internal const string HiddenFileName = "CatTalkHidden.ids";
    internal const string HiddenIdsFieldName = "CatTalkHiddenIds", HiddenPollFieldName = "CatTalkHiddenPoll";
    internal const string ListedName = "CatTalkListed", HideName = "CatTalkHide", VisibleName = "CatTalkVisible", PollName = "CatTalkPoll";
    internal const string MemberTypeName = "BongoCat.Multiplayer.LobbyMemberInstance";
    internal const string VisibilityTypeName = "BongoCat.Multiplayer.LobbyMemberVisibility";
    internal const string SteamUserDataTypeName = "Heathen.SteamworksIntegration.SteamUserData";
    internal const string InstancesTypeName = "System.Collections.Generic.Dictionary`2<Heathen.SteamworksIntegration.UserData," + MemberTypeName + ">";
    internal const int MemberStartInsert = 2, ToggleInsert = 3, SpawnInsert = 1;   // 호출 직전 삽입(①②), Update 처음(③)
    internal const int ItemPopupInsert = 2;   // ldsfld CatTalkTransparent; brtrue <게임의 '오브젝트 없음' ret>
    internal const string RootFieldName = "CatTalkRoot", CloseMenuName = "CatTalkCloseMenu";
    internal const int RootStartInsert = 12, RootSmoothInsert = 17;   // Start(투명화 블록 앞), SetTranslucentSmooth(투명화 블록 다음)

    static T One<T>(IEnumerable<T> items, string code) where T : class {
        var list = items.ToList();
        if (list.Count != 1) throw new Incompatible(code);
        return list[0];
    }

    internal static Target Find(ModuleDefinition module) {
        var t = new Target();
        t.Shop = One(module.GetTypes().Where(x => x.FullName == "BongoCat.Shop"), "shop_type");
        t.ShopItem = One(module.GetTypes().Where(x => x.FullName == "BongoCat.ShopItem"), "shopitem_type");
        t.ShopItemField = One(t.Shop.Fields.Where(f => f.Name == "_shopItem" && !f.IsStatic && f.FieldType.FullName == "BongoCat.ShopItem"), "shop_shopitem_field");
        t.ChestIsReady = One(t.Shop.Fields.Where(f => f.Name == "ChestIsReady" && !f.IsStatic && f.FieldType.MetadataType == MetadataType.Boolean), "shop_chestisready_field");
        One(t.Shop.Fields.Where(f => f.Name == "_isEmoteShop" && f.FieldType.MetadataType == MetadataType.Boolean), "shop_isemoteshop_field");
        t.OnChestReady = One(t.Shop.Methods.Where(m => m.Name == "OnChestReady" && !m.IsStatic && m.Parameters.Count == 0 && m.ReturnType.MetadataType == MetadataType.Void), "shop_onchestready");
        t.Buy = One(t.ShopItem.Methods.Where(m => m.Name == "Buy" && !m.IsStatic && m.Parameters.Count == 0 && m.HasBody), "shopitem_buy");
        var timer = One(t.Shop.Methods.Where(m => m.Name == "TimerUpdate" && !m.IsStatic && m.Parameters.Count == 0), "shop_timerupdate");
        // 상태머신 타입(d__번호는 빌드마다 달라질 수 있어 하드코딩하지 않는다):
        // [IteratorStateMachine(typeof(...))]가 있으면 그것, 없으면(현 게임 빌드 실측: 어트리뷰트 없음) TimerUpdate 본문이
        // 정확히 반복자 스텁(newobj <Shop 중첩타입>::.ctor(int32) → dup → ldarg.0 → stfld <>4__this → ret)일 때만 그 타입.
        var smRef = IteratorStateMachine(timer) ?? IteratorStub(timer, t.Shop);
        if (smRef == null) throw new Incompatible("timerupdate_statemachine_unresolved");
        t.StateMachine = One(t.Shop.NestedTypes.Where(n => n.FullName == smRef.FullName), "timerupdate_statemachine");
        t.This = One(t.StateMachine.Fields.Where(f => f.Name == "<>4__this" && f.FieldType.FullName == "BongoCat.Shop"), "statemachine_this");
        t.MoveNext = One(t.StateMachine.Methods.Where(m => m.Name == "MoveNext" && m.HasBody && m.Parameters.Count == 0), "statemachine_movenext");

        var ins = t.MoveNext.Body.Instructions;
        t.Markers = FindMarkers(ins, FlagName);
        // 앵커: ldc.i4.1; stfld Shop::ChestIsReady 다음에 처음 나오는 Shop::OnChestReady 호출(8개 명령 이내, 분기·반환 없이).
        var anchors = new List<int>();
        for (int i = 1; i < ins.Count; i++) {
            if (ins[i].OpCode != OpCodes.Stfld || !Same(ins[i].Operand as FieldReference, t.ChestIsReady)) continue;
            if (ins[i - 1].OpCode != OpCodes.Ldc_I4_1) continue;
            for (int j = i + 1; j < ins.Count && j <= i + 8; j++) {
                var fc = ins[j].OpCode.FlowControl;
                if ((ins[j].OpCode == OpCodes.Call || ins[j].OpCode == OpCodes.Callvirt) && Same(ins[j].Operand as MethodReference, t.OnChestReady)) { anchors.Add(j); break; }
                if (fc == FlowControl.Branch || fc == FlowControl.Cond_Branch || fc == FlowControl.Return || fc == FlowControl.Throw) break;
            }
        }
        if (anchors.Count != 1) throw new Incompatible("anchor_count_" + anchors.Count);
        t.AnchorIndex = anchors[0];
        t.FindHover(module);
        t.FindHidden(module);
        t.FindItemPopup(module);
        t.FindRoot(module);
        return t;
    }

    // 우리 마커: ldstr "...\<플래그>" 바로 뒤 call System.IO.File::Exists(string)
    static List<int> FindMarkers(IList<Instruction> ins, string flagName) {
        var found = new List<int>();
        for (int i = 0; i + 1 < ins.Count; i++) {
            var s = ins[i].Operand as string;
            if (ins[i].OpCode == OpCodes.Ldstr && s != null && s.EndsWith("\\" + flagName, StringComparison.OrdinalIgnoreCase) && IsFileExists(ins[i + 1])) found.Add(i);
        }
        return found;
    }

    void FindHover(ModuleDefinition module) {
        Hover = One(module.GetTypes().Where(x => x.FullName == "TranslucentOnHover"), "hover_type");
        HoverSetting = One(module.GetTypes().Where(x => x.FullName == "TranslucentOnHoverSetting"), "hoversetting_type");
        HoverAlpha = One(Hover.Fields.Where(f => f.Name == "_alpha" && !f.IsStatic && f.FieldType.FullName == "UnityEngine.CanvasGroup"), "hover_alpha_field");
        LayerUI = One(Hover.Fields.Where(f => f.Name == "_layerUI" && !f.IsStatic && f.FieldType.MetadataType == MetadataType.Int32), "hover_layerui_field");
        var exceptions = One(Hover.Fields.Where(f => f.Name == "_notClickThroughObjects" && !f.IsStatic), "hover_exceptions_field");
        OnSetTranslucent = One(HoverSetting.Fields.Where(f => f.Name == "OnSetTranslucent" && f.IsStatic && f.FieldType.FullName == "System.Action`1<System.Boolean>"), "hoversetting_event");
        Smooth = One(Hover.Methods.Where(m => m.Name == "SetTranslucentSmooth" && !m.IsStatic && m.HasBody && m.Parameters.Count == 1 && m.Parameters[0].ParameterType.MetadataType == MetadataType.Boolean), "hover_smooth");
        Layer = One(Hover.Methods.Where(m => m.Name == "SetLayerRecursively" && !m.IsStatic && m.HasBody && m.Parameters.Count == 2
            && m.Parameters[0].ParameterType.FullName == "UnityEngine.Transform" && m.Parameters[1].ParameterType.MetadataType == MetadataType.Int32), "hover_setlayer");
        HoverStart = One(Hover.Methods.Where(m => m.Name == "Start" && !m.IsStatic && m.HasBody && m.Parameters.Count == 0), "hover_start");
        SettingUpdate = One(HoverSetting.Methods.Where(m => m.Name == "Update" && !m.IsStatic && m.HasBody && m.Parameters.Count == 0), "hoversetting_update");
        StateField = HoverSetting.Fields.SingleOrDefault(f => f.Name == StateFieldName);
        NextPollField = HoverSetting.Fields.SingleOrDefault(f => f.Name == NextPollFieldName);
        var refs = module.GetMemberReferences().OfType<MethodReference>().ToList();
        InvokeBool = One(refs.Where(m => m.Name == "Invoke" && m.DeclaringType.FullName == "System.Action`1<System.Boolean>"), "action_bool_invoke");
        UnscaledTime = One(refs.Where(m => m.Name == "get_unscaledTime" && m.DeclaringType.FullName == "UnityEngine.Time"), "time_unscaledtime");
        // 레이어 블록은 게임이 이미 참조하는 멤버만 쓴다(새 외부 참조 없음)
        GetTransform = One(refs.Where(m => m.Name == "get_transform" && m.DeclaringType.FullName == "UnityEngine.Component" && m.Parameters.Count == 0), "component_get_transform");
        IsChildOf = One(refs.Where(m => m.Name == "IsChildOf" && m.DeclaringType.FullName == "UnityEngine.Transform" && m.Parameters.Count == 1), "transform_ischildof");

        ResultGameObject = One(refs.Where(m => m.Name == "get_gameObject" && m.DeclaringType.FullName == "UnityEngine.EventSystems.RaycastResult"), "raycastresult_gameobject");
        GetLayer = One(refs.Where(m => m.Name == "get_layer" && m.DeclaringType.FullName == "UnityEngine.GameObject"), "gameobject_get_layer");
        FindHoverCallbacks(module);
        FindPopups(module);

        var smooth = Smooth.Body.Instructions;
        SmoothMarkers = FindMarkers(smooth, TransparentFlagName);
        var layer = Layer.Body.Instructions;
        LayerMarkers = Enumerable.Range(0, layer.Count).Where(i => layer[i].OpCode == OpCodes.Ldsfld && IsStateField(layer[i].Operand as FieldReference)).ToList();
        StartMarkers = FindMarkers(HoverStart.Body.Instructions, TransparentFlagName);
        UpdateMarkers = FindMarkers(SettingUpdate.Body.Instructions, TransparentFlagName);

        // 앵커: 목표 알파를 지역 0에 넣는 stloc.0(원본에 하나, 패치 후에는 투명값을 덮는 우리 것이 하나 더). 메서드는 DOFade로 _alpha를 움직여야 한다.
        if (Smooth.Body.Variables.Count == 0 || Smooth.Body.Variables[0].VariableType.MetadataType != MetadataType.Single) throw new Incompatible("hover_smooth_local");
        if (!smooth.Any(i => { var m = i.Operand as MethodReference; return m != null && m.Name == "DOFade"; })) throw new Incompatible("hover_smooth_dofade");
        var stores = Enumerable.Range(0, smooth.Count).Where(i => smooth[i].OpCode == OpCodes.Stloc_0).ToList();
        if (stores.Count != (SmoothMarkers.Count == 0 ? 1 : 2)) throw new Incompatible("hover_smooth_anchor_" + stores.Count);
        SmoothAnchor = stores[0];

        // 앵커: "if (_notClickThroughObjects.Contains(t.gameObject)) return;"의 brfalse. 원본은 바로 다음이 그 ret이다.
        var gates = new List<int>();
        for (int i = 4; i + 1 < layer.Count; i++) {
            var m = layer[i].Operand as MethodReference;
            if (layer[i].OpCode != OpCodes.Call || m == null || m.Name != "Contains") continue;
            if (layer[i - 4].OpCode != OpCodes.Ldarg_0 || layer[i - 3].OpCode != OpCodes.Ldfld || !Same(layer[i - 3].Operand as FieldReference, exceptions)) continue;
            if (layer[i + 1].OpCode != OpCodes.Brfalse_S && layer[i + 1].OpCode != OpCodes.Brfalse) continue;
            gates.Add(i + 1);
        }
        if (gates.Count != 1) throw new Incompatible("hover_setlayer_gate_" + gates.Count);
        LayerAnchor = gates[0];
        if (LayerMarkers.Count == 0 && (LayerAnchor + 2 >= layer.Count || layer[LayerAnchor + 1].OpCode != OpCodes.Ret || layer[LayerAnchor].Operand != layer[LayerAnchor + 2]))
            throw new Incompatible("hover_setlayer_shape");

        var start = HoverStart.Body.Instructions;
        if (start.Count(i => i.OpCode == OpCodes.Ret) != 1 || start[start.Count - 1].OpCode != OpCodes.Ret) throw new Incompatible("hover_start_shape");
        if (!start.Any(i => i.OpCode == OpCodes.Stsfld && Same(i.Operand as FieldReference, OnSetTranslucent))) throw new Incompatible("hover_start_subscribe");
    }

    void FindHoverCallbacks(ModuleDefinition module) {
        var hoverCb = One(module.GetTypes().Where(x => x.FullName == "OnUIHoverCallback"), "uihover_type");
        OverUI = One(hoverCb.Methods.Where(m => m.Name == "IsPointerOverUIElement" && !m.IsStatic && m.HasBody && m.Parameters.Count == 0 && m.ReturnType.MetadataType == MetadataType.Boolean), "uihover_overui");
        var ignore = One(hoverCb.Fields.Where(f => f.Name == "_ignoreLayer" && !f.IsStatic && f.FieldType.MetadataType == MetadataType.Int32), "uihover_ignore_field");
        var ui = One(hoverCb.Fields.Where(f => f.Name == "_uiLayer" && !f.IsStatic && f.FieldType.MetadataType == MetadataType.Int32), "uihover_ui_field");
        var specific = One(module.GetTypes().Where(x => x.FullName == "BongoCat.OnSpecificUIHoverCallback"), "specifichover_type");
        // 결과 필터는 컴파일러가 만든 람다라 이름(<Recalculate>b__5_0)이 빌드마다 바뀔 수 있어 모양으로 찾는다
        HoverFilter = One(specific.Methods.Where(m => !m.IsStatic && m.HasBody && m.ReturnType.MetadataType == MetadataType.Boolean && m.Parameters.Count == 1
            && m.Parameters[0].ParameterType.FullName == "UnityEngine.EventSystems.RaycastResult"
            && m.Body.Instructions.Any(i => { var r = i.Operand as MethodReference; return r != null && r.Name == "IsChildOf"; })), "specifichover_filter");

        var over = OverUI.Body.Instructions;
        OverUIMarkers = Enumerable.Range(0, over.Count).Where(i => over[i].OpCode == OpCodes.Ldsfld && IsStateField(over[i].Operand as FieldReference)).ToList();
        var gates = Enumerable.Range(0, over.Count - 1).Where(i => over[i].OpCode == OpCodes.Ldfld && Same(over[i].Operand as FieldReference, ignore)
            && (over[i + 1].OpCode == OpCodes.Bne_Un_S || over[i + 1].OpCode == OpCodes.Bne_Un)).ToList();
        if (gates.Count != 1) throw new Incompatible("uihover_overui_gate_" + gates.Count);
        OverUIAnchor = gates[0] + 1;
        // 원본: bne.un 바로 다음이 UI 레이어 분기(beq)의 대상(= 호버 처리 시작)이다
        bool uiJoins = Enumerable.Range(1, over.Count - 1).Any(j => (over[j].OpCode == OpCodes.Beq_S || over[j].OpCode == OpCodes.Beq)
            && over[j - 1].OpCode == OpCodes.Ldfld && Same(over[j - 1].Operand as FieldReference, ui)
            && over[j].Operand == over[OverUIAnchor + 1 + (OverUIMarkers.Count == 0 ? 0 : OverUIInsert)]);
        if (!uiJoins) throw new Incompatible("uihover_overui_shape");

        var filter = HoverFilter.Body.Instructions;
        FilterMarkers = Enumerable.Range(0, filter.Count).Where(i => filter[i].OpCode == OpCodes.Ldsfld && IsStateField(filter[i].Operand as FieldReference)).ToList();
    }

    void FindPopups(ModuleDefinition module) {
        var disable = One(HoverSetting.Fields.Where(f => f.Name == "DisablePopups" && !f.IsStatic && f.FieldType.MetadataType == MetadataType.Boolean), "hoversetting_disablepopups");
        var donut = One(module.GetTypes().Where(x => x.FullName == "EmoteDonut"), "donut_type");
        var speech = One(module.GetTypes().Where(x => x.FullName == "Vfx.CatSpeech"), "speech_type");
        DonutUpdate = One(donut.Methods.Where(m => m.Name == "Update" && !m.IsStatic && m.HasBody && m.Parameters.Count == 0), "donut_update");
        SpeechUpdate = One(speech.Methods.Where(m => m.Name == "Update" && !m.IsStatic && m.HasBody && m.Parameters.Count == 0), "speech_update");
        DonutAnchor = PopupGate(DonutUpdate, disable, "donut_gate_");
        SpeechAnchor = PopupGate(SpeechUpdate, disable, "speech_gate_");
        DonutMarkers = StateReads(DonutUpdate);
        SpeechMarkers = StateReads(SpeechUpdate);
    }

    // 앵커: ldfld DisablePopups 바로 다음의 brtrue(= 팝업을 숨기는 쪽으로). 메서드에 정확히 하나.
    static int PopupGate(MethodDefinition m, FieldDefinition disable, string code) {
        var ins = m.Body.Instructions;
        var gates = Enumerable.Range(0, ins.Count - 1).Where(i => ins[i].OpCode == OpCodes.Ldfld && Same(ins[i].Operand as FieldReference, disable)
            && (ins[i + 1].OpCode == OpCodes.Brtrue_S || ins[i + 1].OpCode == OpCodes.Brtrue)).ToList();
        if (gates.Count != 1) throw new Incompatible(code + gates.Count);
        return gates[0] + 1;
    }

    static List<int> StateReads(MethodDefinition m) {
        var ins = m.Body.Instructions;
        return Enumerable.Range(0, ins.Count).Where(i => ins[i].OpCode == OpCodes.Ldsfld && IsStateField(ins[i].Operand as FieldReference)).ToList();
    }

    // 투명화 훅이 전부 제자리에 있는지. 전부 없으면 false, 일부만 있으면 호환 안 됨.
    internal bool TransparentHooked {
        get {
            bool any = SmoothMarkers.Count + LayerMarkers.Count + StartMarkers.Count + UpdateMarkers.Count + OverUIMarkers.Count + FilterMarkers.Count
                + DonutMarkers.Count + SpeechMarkers.Count > 0 || StateField != null || NextPollField != null;
            if (!any) return false;
            bool whole = SmoothMarkers.Count == 1 && SmoothMarkers[0] == SmoothAnchor + 1 + SmoothMarkerAt
                && OverUIMarkers.Count == 1 && OverUIMarkers[0] == OverUIAnchor + 1
                && FilterMarkers.Count == 1 && FilterMarkers[0] == 0
                && DonutMarkers.Count == 1 && DonutMarkers[0] == DonutAnchor + 1
                && SpeechMarkers.Count == 1 && SpeechMarkers[0] == SpeechAnchor + 1
                && LayerMarkers.Count == 1 && LayerMarkers[0] == LayerAnchor + 1 + LayerMarkerAt
                && StartMarkers.Count == 1 && StartMarkers[0] == HoverStart.Body.Instructions.Count - 1 - StartInsert
                && UpdateMarkers.Count == 1 && UpdateMarkers[0] == UpdateMarkerAt
                && StateField != null && StateField.IsStatic && StateField.FieldType.MetadataType == MetadataType.Boolean
                && NextPollField != null && NextPollField.IsStatic && NextPollField.FieldType.MetadataType == MetadataType.Single;
            if (!whole) throw new Incompatible("transparent_partial");
            return true;
        }
    }

    // 차단 멤버 고양이 숨김 대상(D-033 3단계). 게임 숨김 기능의 구조가 분석 때와 같을 때만 받는다.
    // 숨김 setter·getter·PlayerDataCache·SetVisibility와 그 호출 대상은 Cat Talk 연결 지문 범위라 읽기만 하고 고치지 않는다.
    void FindHidden(ModuleDefinition module) {
        Member = One(module.GetTypes().Where(x => x.FullName == MemberTypeName), "member_type");
        Visibility = One(module.GetTypes().Where(x => x.FullName == VisibilityTypeName), "visibility_type");
        SpawnManager = One(module.GetTypes().Where(x => x.FullName == "BongoCat.Multiplayer.Spawning.CatSpawnManager"), "spawn_type");
        var lobbyRefs = One(module.GetTypes().Where(x => x.FullName == "BongoCat.Multiplayer.MultiplayerLobbyReferences"), "lobbyrefs_type");
        var settings = One(module.GetTypes().Where(x => x.FullName == "BongoCat.SettingsManager"), "settings_type");
        var toggle = One(module.GetTypes().Where(x => x.FullName == "BongoCat.PlayerPrefsToggle"), "toggle_type");
        SteamUserDataField = One(Member.Fields.Where(f => f.Name == "steamUserData" && !f.IsStatic && f.FieldType.FullName == SteamUserDataTypeName), "member_steamuserdata");
        VisibilityUserField = One(Visibility.Fields.Where(f => f.Name == "_steamUserData" && !f.IsStatic && f.FieldType.FullName == SteamUserDataTypeName), "visibility_steamuserdata");
        Getter = One(Member.Methods.Where(m => m.Name == "get_IsHidden" && !m.IsStatic && m.HasBody && m.Parameters.Count == 0 && m.ReturnType.MetadataType == MetadataType.Boolean), "member_getter");
        Setter = One(Member.Methods.Where(m => m.Name == "set_IsHidden" && !m.IsStatic && m.HasBody && m.Parameters.Count == 1
            && m.Parameters[0].ParameterType.MetadataType == MetadataType.Boolean && m.ReturnType.MetadataType == MetadataType.Void), "member_setter");
        MemberStart = One(Member.Methods.Where(m => m.Name == "Start" && !m.IsStatic && m.HasBody && m.Parameters.Count == 0 && m.ReturnType.MetadataType == MetadataType.Void), "member_start");
        SetVisibility = One(Visibility.Methods.Where(m => m.Name == "SetVisibility" && !m.IsStatic && m.HasBody && m.Parameters.Count == 1
            && m.Parameters[0].ParameterType.MetadataType == MetadataType.Boolean && m.ReturnType.MetadataType == MetadataType.Void), "visibility_set");
        VisibilityToggle = One(Visibility.Methods.Where(m => m.Name == "HandleAutoHideUpdated" && !m.IsStatic && m.HasBody && m.Parameters.Count == 1
            && m.Parameters[0].ParameterType.MetadataType == MetadataType.Boolean && m.ReturnType.MetadataType == MetadataType.Void), "visibility_toggle");
        SpawnUpdate = One(SpawnManager.Methods.Where(m => m.Name == "Update" && !m.IsStatic && m.HasBody && m.Parameters.Count == 0 && m.ReturnType.MetadataType == MetadataType.Void), "spawn_update");
        Instances = One(lobbyRefs.Fields.Where(f => f.Name == "GameplayInstances" && f.IsStatic && f.FieldType.FullName == InstancesTypeName), "lobbyrefs_instances");
        SettingsInstance = One(settings.Fields.Where(f => f.Name == "Instance" && f.IsStatic && f.FieldType.FullName == "BongoCat.SettingsManager"), "settings_instance");
        AutoHide = One(settings.Fields.Where(f => f.Name == "AutoHideCats" && !f.IsStatic && f.FieldType.FullName == "BongoCat.PlayerPrefsToggle"), "settings_autohide");
        ToggleValue = One(toggle.Methods.Where(m => m.Name == "get_Value" && !m.IsStatic && m.Parameters.Count == 0 && m.ReturnType.MetadataType == MetadataType.Boolean), "toggle_value");
        // 멤버 사전 값 목록과 Enumerable.ToArray는 게임이 이미 참조하는 것을 쓴다(FlipAllCats·EmoteDonut, 실측)
        var refs = module.GetMemberReferences().OfType<MethodReference>().ToList();
        Values = One(refs.Where(m => m.Name == "get_Values" && m.DeclaringType.FullName == InstancesTypeName && m.Parameters.Count == 0), "instances_values");
        ToArrayOpen = One(refs.Where(m => m.Name == "ToArray" && m.DeclaringType.FullName == "System.Linq.Enumerable" && m.HasGenericParameters && m.Parameters.Count == 1), "enumerable_toarray");

        // 게임 숨김의 키: get_IsHidden = PlayerDataCache.GetIsHidden(steamUserData.Data.IdStr)(SteamID64 십진 문자열). 같은 참조로 멤버 ID를 읽는다.
        var g = Getter.Body.Instructions;
        bool getterOk = g.Count == 8 && Getter.Body.Variables.Count == 1
            && g[0].OpCode == OpCodes.Ldarg_0 && g[1].OpCode == OpCodes.Ldfld && Same(g[1].Operand as FieldReference, SteamUserDataField)
            && g[2].OpCode == OpCodes.Callvirt && CallsNamed(g[2], "SteamUserData", "get_Data")
            && g[3].OpCode == OpCodes.Stloc_0 && g[4].OpCode == OpCodes.Ldloca_S
            && g[5].OpCode == OpCodes.Call && CallsNamed(g[5], "UserData", "get_IdStr")
            && g[6].OpCode == OpCodes.Call && CallsNamed(g[6], "PlayerDataCache", "GetIsHidden")
            && g[7].OpCode == OpCodes.Ret;
        if (!getterOk) throw new Incompatible("member_getter_shape");
        GetData = (MethodReference)g[2].Operand;
        GetIdStr = (MethodReference)g[5].Operand;
        UserDataType = Getter.Body.Variables[0].VariableType;
        if (UserDataType.FullName != "Heathen.SteamworksIntegration.UserData" || GetData.ReturnType.FullName != UserDataType.FullName
            || GetIdStr.ReturnType.MetadataType != MetadataType.String || GetIdStr.Parameters.Count != 0) throw new Incompatible("member_getter_shape");
        // set_IsHidden은 게임 숨김 저장(PlayerDataCache.SetIsHidden)과 고양이 켜고 끄기(GameObject.SetActive)를 하는 그 setter여야 한다
        var s = Setter.Body.Instructions;
        if (!s.Any(i => CallsNamed(i, "PlayerDataCache", "SetIsHidden")) || !s.Any(i => CallsNamed(i, "GameObject", "SetActive"))) throw new Incompatible("member_setter_shape");
        // setter에 우리 훅이 있으면(2026-11-10 시험본: setter 입구 훅 — Cat Talk 연결 지문을 깨 연결이 멈췄다) 다시 패치하지 않는다
        if (s.Any(i => { var r = i.Operand as MethodReference; return r != null && r.DeclaringType.FullName == MemberTypeName && r.Name.StartsWith("CatTalk", StringComparison.Ordinal); }))
            throw new Incompatible("hidden_setter_hook");
        // SetVisibility(게임 참여자 목록의 보이기/숨기기 버튼·자동 숨김 토글)는 그 setter를 부르는 경로여야 한다
        if (!SetVisibility.Body.Instructions.Any(i => (i.OpCode == OpCodes.Call || i.OpCode == OpCodes.Callvirt) && Same(i.Operand as MethodReference, Setter)))
            throw new Incompatible("visibility_set_shape");

        // 앵커 ①: Start의 set_IsHidden 호출(정확히 하나). Start는 자동 숨김 설정을 읽어 처음 숨김 상태를 정한다.
        var start = MemberStart.Body.Instructions;
        var startCalls = CallsTo(start, Setter);
        if (startCalls.Count != 1) throw new Incompatible("member_start_call_" + startCalls.Count);
        StartCall = startCalls[0];
        if (!start.Any(i => i.OpCode == OpCodes.Ldfld && Same(i.Operand as FieldReference, AutoHide))) throw new Incompatible("member_start_shape");
        // 앵커 ②: HandleAutoHideUpdated의 SetVisibility 호출(정확히 하나). 자동 숨김 설정값으로 보이기 여부를 정한다.
        var tog = VisibilityToggle.Body.Instructions;
        var toggleCalls = CallsTo(tog, SetVisibility);
        if (toggleCalls.Count != 1) throw new Incompatible("visibility_toggle_call_" + toggleCalls.Count);
        ToggleCall = toggleCalls[0];
        if (!tog.Any(i => i.OpCode == OpCodes.Ldfld && Same(i.Operand as FieldReference, AutoHide))) throw new Incompatible("visibility_toggle_shape");

        HiddenIdsField = Member.Fields.SingleOrDefault(f => f.Name == HiddenIdsFieldName);
        HiddenPollField = Member.Fields.SingleOrDefault(f => f.Name == HiddenPollFieldName);
        ListedMethod = Member.Methods.SingleOrDefault(m => m.Name == ListedName);
        HideMethod = Member.Methods.SingleOrDefault(m => m.Name == HideName);
        VisibleMethod = Member.Methods.SingleOrDefault(m => m.Name == VisibleName);
        PollMethod = Member.Methods.SingleOrDefault(m => m.Name == PollName);
        MemberStartMarkers = MemberCalls(MemberStart, HideName);
        ToggleMarkers = MemberCalls(VisibilityToggle, VisibleName);
        SpawnMarkers = MemberCalls(SpawnUpdate, PollName);
    }

    static List<int> CallsTo(IList<Instruction> ins, MethodDefinition target) {
        return Enumerable.Range(0, ins.Count).Where(i => (ins[i].OpCode == OpCodes.Call || ins[i].OpCode == OpCodes.Callvirt) && Same(ins[i].Operand as MethodReference, target)).ToList();
    }

    static bool CallsNamed(Instruction i, string type, string name) {
        var m = i.Operand as MethodReference;
        return (i.OpCode == OpCodes.Call || i.OpCode == OpCodes.Callvirt) && m != null && m.Name == name && m.DeclaringType.Name == type;
    }

    // LobbyMemberInstance의 (우리가 더한) 메서드를 부르는 명령 위치
    static List<int> MemberCalls(MethodDefinition m, string name) {
        var ins = m.Body.Instructions;
        return Enumerable.Range(0, ins.Count).Where(i => {
            var r = ins[i].Operand as MethodReference;
            return (ins[i].OpCode == OpCodes.Call || ins[i].OpCode == OpCodes.Callvirt) && r != null && r.Name == name && r.DeclaringType.FullName == MemberTypeName;
        }).ToList();
    }

    // 숨김 훅이 전부 제자리에 있는지. 전부 없으면 false, 일부만 있으면 호환 안 됨.
    internal bool HiddenHooked {
        get {
            bool any = HiddenIdsField != null || HiddenPollField != null || ListedMethod != null || HideMethod != null || VisibleMethod != null || PollMethod != null
                || MemberStartMarkers.Count > 0 || ToggleMarkers.Count > 0 || SpawnMarkers.Count > 0;
            if (!any) return false;
            var start = MemberStart.Body.Instructions;
            var tog = VisibilityToggle.Body.Instructions;
            bool whole = HiddenIdsField != null && HiddenIdsField.IsStatic && HiddenIdsField.FieldType.MetadataType == MetadataType.String
                && HiddenPollField != null && HiddenPollField.IsStatic && HiddenPollField.FieldType.MetadataType == MetadataType.Single
                && new[] { ListedMethod, HideMethod, VisibleMethod, PollMethod }.All(m => m != null && m.IsStatic && m.HasBody)
                && MemberStartMarkers.Count == 1 && StartCall >= 2 && MemberStartMarkers[0] == StartCall - 1 && start[StartCall - 2].OpCode == OpCodes.Ldarg_0
                && ToggleMarkers.Count == 1 && ToggleCall >= 3 && ToggleMarkers[0] == ToggleCall - 1 && tog[ToggleCall - 3].OpCode == OpCodes.Ldarg_0
                && tog[ToggleCall - 2].OpCode == OpCodes.Ldfld && Same(tog[ToggleCall - 2].Operand as FieldReference, VisibilityUserField)
                && SpawnMarkers.Count == 1 && SpawnMarkers[0] == 0;
            if (!whole) throw new Incompatible("hidden_partial");
            return true;
        }
    }

    // 숨김 목록 파일 경로(CatTalkPoll이 File.Exists로 보는 리터럴). 훅이 없으면 null.
    internal string HiddenFile {
        get {
            if (PollMethod == null || !PollMethod.HasBody) return null;
            var i = PollMethod.Body.Instructions.FirstOrDefault(x => x.OpCode == OpCodes.Ldstr && ((string)x.Operand).EndsWith("\\" + HiddenFileName, StringComparison.OrdinalIgnoreCase));
            return i == null ? null : (string)i.Operand;
        }
    }

    // 우리가 더한 메서드(본문 전체가 패치 산출물)
    internal MethodDefinition[] HiddenAdded { get { return new[] { ListedMethod, HideMethod, VisibleMethod, PollMethod }.Where(m => m != null).ToArray(); } }

    // 획득 팝업 게이트 대상(D-046, 세트 4). 분석 때 구조(원본 IL)와 같을 때만 받는다:
    //   if (!SteamItemIdReference.Inst.TryGetItem(id, out _)) return;
    //   if (_sendMultiplayerMessage) SteamMultiplayer.SendReceivedItem(id);   ← 전송(다른 참여자 화면의 내 팝업). 게이트는 이 다음이다
    //   if (!gameObject) return;                                             ← 게이트가 가는 ret
    //   _queue.Enqueue(id); if (_showPopupRoutine == null) { gameObject.SetActive(true); StartCoroutine(DoShowPopup()); }
    void FindItemPopup(ModuleDefinition module) {
        ItemPopup = One(module.GetTypes().Where(x => x.FullName == "NewItemPopup"), "itempopup_type");
        ShowPopup = One(ItemPopup.Methods.Where(m => m.Name == "ShowPopup" && !m.IsStatic && m.HasBody && m.Parameters.Count == 1
            && m.Parameters[0].ParameterType.MetadataType == MetadataType.Int32 && m.ReturnType.MetadataType == MetadataType.Void), "itempopup_show");
        var send = One(ItemPopup.Fields.Where(f => f.Name == "_sendMultiplayerMessage" && !f.IsStatic && f.FieldType.MetadataType == MetadataType.Boolean), "itempopup_send_field");
        var ins = ShowPopup.Body.Instructions;
        var calls = Enumerable.Range(0, ins.Count).Where(i => ins[i].OpCode == OpCodes.Call && CallsNamed(ins[i], "SteamMultiplayer", "SendReceivedItem")).ToList();
        if (calls.Count != 1) throw new Incompatible("itempopup_send_call_" + calls.Count);
        PopupAt = calls[0] + 1;
        ItemPopupMarkers = StateReads(ShowPopup);
        // 전송 분기: ldarg.0; ldfld _sendMultiplayerMessage; brfalse <합류점>; ldarg.1; call SendReceivedItem
        int gate = calls[0] - 2;
        bool sendShape = gate >= 2 && ins[gate - 2].OpCode == OpCodes.Ldarg_0 && ins[gate - 1].OpCode == OpCodes.Ldfld && Same(ins[gate - 1].Operand as FieldReference, send)
            && (ins[gate].OpCode == OpCodes.Brfalse_S || ins[gate].OpCode == OpCodes.Brfalse) && ins[gate + 1].OpCode == OpCodes.Ldarg_1;
        // 원본의 전송 분기는 곧바로 합류점으로 간다(패치본은 게이트 처음으로 옮겨져 있다 — verify가 본다)
        if (!sendShape || (ItemPopupMarkers.Count == 0 && ins[gate].Operand != ins[PopupAt])) throw new Incompatible("itempopup_shape");
        // 합류점(게이트가 있으면 그 다음): "if (!gameObject) return;"
        int join = PopupAt + (ItemPopupMarkers.Count == 0 ? 0 : ItemPopupInsert);
        bool joinShape = join + 4 < ins.Count && ins[join].OpCode == OpCodes.Ldarg_0 && CallsNamed(ins[join + 1], "Component", "get_gameObject")
            && CallsNamed(ins[join + 2], "Object", "op_Implicit") && (ins[join + 3].OpCode == OpCodes.Brtrue_S || ins[join + 3].OpCode == OpCodes.Brtrue)
            && ins[join + 4].OpCode == OpCodes.Ret;
        if (!joinShape) throw new Incompatible("itempopup_shape");
    }

    // 획득 팝업 게이트가 제자리에 있는지. 없으면 false, 있는데 자리가 다르면 호환 안 됨.
    internal bool ItemPopupHooked {
        get {
            if (ItemPopupMarkers.Count == 0) return false;
            if (ItemPopupMarkers.Count != 1 || ItemPopupMarkers[0] != PopupAt) throw new Incompatible("itempopup_partial");
            return true;
        }
    }

    // 투명화 루트 후크 대상(D-047, 세트 5). FindHover·FindPopups 뒤에 부른다(Smooth·Start·DonutUpdate와 그 앵커를 쓴다).
    void FindRoot(ModuleDefinition module) {
        Donut = DonutUpdate.DeclaringType;
        DonutMenu = One(Donut.Fields.Where(f => f.Name == "_menu" && !f.IsStatic && f.FieldType.FullName == "UnityEngine.GameObject"), "root_donut_menu");
        DonutInstance = One(Donut.Fields.Where(f => f.Name == "Instance" && f.IsStatic && f.IsPublic && f.FieldType.FullName == Donut.FullName), "root_donut_instance");
        // 게임 메뉴 닫기 버튼(MenuNew/CloseButton)이 부르는 경로: ToggleGameObject.Toggle → SetActive(false) → gameObject.SetActive + OnToggle(씬 실측)
        Toggle = One(module.GetTypes().Where(x => x.FullName == "ToggleGameObject"), "root_toggle_type");
        ToggleSetActive = One(Toggle.Methods.Where(m => m.Name == "SetActive" && m.IsPublic && !m.IsStatic && m.HasBody && m.Parameters.Count == 1
            && m.Parameters[0].ParameterType.MetadataType == MetadataType.Boolean && m.ReturnType.MetadataType == MetadataType.Void), "root_toggle_setactive");
        if (!ToggleSetActive.Body.Instructions.Any(i => CallsNamed(i, "GameObject", "SetActive"))) throw new Incompatible("root_toggle_shape");
        // 루트 블록·메뉴 닫기는 게임이 이미 참조하는 멤버를 쓴다(AddComponent<CanvasGroup>만 새 참조 — 런타임 해석 검증이 본다)
        var refs = module.GetMemberReferences().OfType<MethodReference>().ToList();
        OpEquality = One(refs.Where(m => m.Name == "op_Equality" && m.DeclaringType.FullName == "UnityEngine.Object" && m.Parameters.Count == 2), "object_op_equality");
        OpImplicit = One(refs.Where(m => m.Name == "op_Implicit" && m.DeclaringType.FullName == "UnityEngine.Object" && m.Parameters.Count == 1
            && m.ReturnType.MetadataType == MetadataType.Boolean), "object_op_implicit");
        GetGameObject = One(refs.Where(m => m.Name == "get_gameObject" && m.DeclaringType.FullName == "UnityEngine.Component" && m.Parameters.Count == 0), "component_get_gameobject");
        GoGetComponent = One(refs.Where(m => m.Name == "GetComponent" && m.DeclaringType.FullName == "UnityEngine.GameObject" && m.HasGenericParameters && m.Parameters.Count == 0), "gameobject_getcomponent");
        GoSetActive = One(refs.Where(m => m.Name == "SetActive" && m.DeclaringType.FullName == "UnityEngine.GameObject" && m.Parameters.Count == 1), "gameobject_setactive");
        GoActiveSelf = One(refs.Where(m => m.Name == "get_activeSelf" && m.DeclaringType.FullName == "UnityEngine.GameObject" && m.Parameters.Count == 0), "gameobject_activeself");
        // 루트 알파는 '목표 알파 == 0'으로 투명화 중을 판정한다. 게임 목표가 지금처럼 상수(켬 0.1, 끔 1, 둘 다 0 아님)일 때만 받는다:
        //   ldarg.1; brtrue <켬>; ldc.r4 <끔>; br <저장>; ldc.r4 <켬>; stloc.0
        var s = Smooth.Body.Instructions;
        bool targets = SmoothAnchor == 5 && s[0].OpCode == OpCodes.Ldarg_1 && (s[1].OpCode == OpCodes.Brtrue_S || s[1].OpCode == OpCodes.Brtrue)
            && s[2].OpCode == OpCodes.Ldc_R4 && (s[3].OpCode == OpCodes.Br_S || s[3].OpCode == OpCodes.Br) && s[4].OpCode == OpCodes.Ldc_R4
            && (float)s[2].Operand != 0f && (float)s[4].Operand != 0f;
        if (!targets) throw new Incompatible("root_smooth_targets");

        RootField = Hover.Fields.SingleOrDefault(f => f.Name == RootFieldName);
        CloseMenuMethod = Donut.Methods.SingleOrDefault(m => m.Name == CloseMenuName);
        var start = HoverStart.Body.Instructions;
        RootStartMarkers = Enumerable.Range(0, start.Count).Where(i => start[i].OpCode == OpCodes.Stfld && IsRootField(start[i].Operand as FieldReference)).ToList();
        RootSmoothMarkers = Enumerable.Range(0, s.Count).Where(i => s[i].OpCode == OpCodes.Ldfld && IsRootField(s[i].Operand as FieldReference)).ToList();
        CloseMenuCalls = Enumerable.Range(0, s.Count).Where(i => {
            var r = s[i].Operand as MethodReference;
            return s[i].OpCode == OpCodes.Call && r != null && r.Name == CloseMenuName && r.DeclaringType.FullName == Donut.FullName;
        }).ToList();
    }

    static bool IsRootField(FieldReference f) { return f != null && f.Name == RootFieldName && f.DeclaringType.FullName == "TranslucentOnHover"; }

    // 루트 블록 위치(투명화 블록이 있을 때만 의미가 있다): Start는 투명화 블록 바로 앞, Smooth는 투명화 블록 바로 다음
    internal int RootStartAt { get { return HoverStart.Body.Instructions.Count - 1 - StartInsert - RootStartInsert; } }
    internal int RootSmoothAt { get { return SmoothAnchor + 1 + SmoothInsert; } }

    // 루트 후크가 전부 제자리에 있는지. 전부 없으면 false, 일부만 있으면 호환 안 됨.
    internal bool RootHooked {
        get {
            bool any = RootField != null || CloseMenuMethod != null || RootStartMarkers.Count + RootSmoothMarkers.Count + CloseMenuCalls.Count > 0;
            if (!any) return false;
            bool whole = RootField != null && !RootField.IsStatic && RootField.IsPrivate && RootField.FieldType.FullName == "UnityEngine.CanvasGroup"
                && CloseMenuMethod != null && CloseMenuMethod.IsStatic && CloseMenuMethod.HasBody
                && RootStartMarkers.Count == 1 && RootStartMarkers[0] == RootStartAt + RootStartInsert - 1
                && RootSmoothMarkers.Count == 2 && RootSmoothMarkers[0] == RootSmoothAt + 1
                && CloseMenuCalls.Count == 1 && CloseMenuCalls[0] == RootSmoothAt + RootSmoothInsert - 1;
            if (!whole) throw new Incompatible("root_partial");
            return true;
        }
    }

    // 패치가 더한 메서드 전부(본문 전체가 패치 산출물)
    internal MethodDefinition[] Added { get { return HiddenAdded.Concat(new[] { CloseMenuMethod }.Where(m => m != null)).ToArray(); } }

    static TypeReference IteratorStateMachine(MethodDefinition m) {
        var attrs = m.CustomAttributes.Where(a => a.AttributeType.FullName == "System.Runtime.CompilerServices.IteratorStateMachineAttribute").ToList();
        if (attrs.Count == 0) return null;
        if (attrs.Count != 1 || attrs[0].ConstructorArguments.Count != 1) throw new Incompatible("timerupdate_iterator_attr");
        var type = attrs[0].ConstructorArguments[0].Value as TypeReference;
        if (type == null) throw new Incompatible("timerupdate_iterator_attr");
        return type;
    }

    static TypeReference IteratorStub(MethodDefinition m, TypeDefinition owner) {
        if (!m.HasBody) return null;
        var i = m.Body.Instructions;
        if (i.Count != 6 || i[0].OpCode != OpCodes.Ldc_I4_0 || i[1].OpCode != OpCodes.Newobj || i[2].OpCode != OpCodes.Dup
            || i[3].OpCode != OpCodes.Ldarg_0 || i[4].OpCode != OpCodes.Stfld || i[5].OpCode != OpCodes.Ret) return null;
        var ctor = i[1].Operand as MethodReference;
        var field = i[4].Operand as FieldReference;
        if (ctor == null || field == null || ctor.Name != ".ctor" || ctor.Parameters.Count != 1 || ctor.Parameters[0].ParameterType.MetadataType != MetadataType.Int32) return null;
        if (field.Name != "<>4__this" || field.DeclaringType.FullName != ctor.DeclaringType.FullName) return null;
        var nested = ctor.DeclaringType.Resolve();
        if (nested == null || nested.DeclaringType != owner) return null;
        return ctor.DeclaringType;
    }

    internal static bool IsFileExists(Instruction i) {
        var m = i.Operand as MethodReference;
        return i.OpCode == OpCodes.Call && m != null && m.Name == "Exists" && m.DeclaringType.FullName == "System.IO.File"
            && m.Parameters.Count == 1 && m.Parameters[0].ParameterType.MetadataType == MetadataType.String && m.ReturnType.MetadataType == MetadataType.Boolean;
    }
    static bool Same(FieldReference a, FieldDefinition b) { return a != null && a.Name == b.Name && a.DeclaringType.FullName == b.DeclaringType.FullName; }
    static bool IsStateField(FieldReference f) { return f != null && f.Name == StateFieldName && f.DeclaringType.FullName == "TranslucentOnHoverSetting"; }
    static bool Same(MethodReference a, MethodDefinition b) { return a != null && a.Name == b.Name && a.DeclaringType.FullName == b.DeclaringType.FullName && a.Parameters.Count == b.Parameters.Count; }

    // 패치가 본문을 바꾸는 메서드 전부.
    internal MethodDefinition[] Patched { get { return new[] { MoveNext, Smooth, Layer, HoverStart, SettingUpdate, OverUI, HoverFilter, DonutUpdate, SpeechUpdate, MemberStart, VisibilityToggle, SpawnUpdate, ShowPopup }; } }

    // 삽입 시퀀스(분기 대상 제외). Buy가 non-void면 pop 포함.
    internal int InsertLength { get { return Buy.ReturnType.MetadataType == MetadataType.Void ? 7 : 8; } }
}

static class Program {
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

    static int Main(string[] args) {
        try {
            if (args.Length == 0) throw new ArgumentException("usage");
            switch (args[0]) {
                case "inspect": Need(args, 2); return Inspect(args[1]);
                case "patch": Need(args, 5); return Patch(args[1], args[2], args[3], args[4]);
                case "verify": Need(args, 5); return Verify(args[1], args[2], args[3], args[4]);
                case "backup": Need(args, 3); return Backup(args[1], args[2]);
                case "restore": Need(args, 3); return Restore(args[1], args[2]);
                case "version": Need(args, 1); return ToolVersion();
                default: throw new ArgumentException("usage");
            }
        } catch (Incompatible e) {
            return Emit(2, new Dictionary<string, object> { { "ok", false }, { "state", "incompatible" }, { "reason", e.Message } });
        } catch (Exception e) {
            // 경로·원문을 내보내지 않는다(예외 종류만). 진단은 CATTALK_PATCHER_DEBUG=1일 때만 stderr로.
            if (Environment.GetEnvironmentVariable("CATTALK_PATCHER_DEBUG") == "1") Console.Error.WriteLine(e);
            return Emit(1, new Dictionary<string, object> { { "ok", false }, { "state", "error" }, { "reason", e.GetType().Name } });
        }
    }

    static void Need(string[] a, int n) { if (a.Length != n) throw new ArgumentException("usage"); }
    static int Emit(int code, Dictionary<string, object> o) { Console.WriteLine(Json.Serialize(o)); return code; }

    static string Sha256(string path) {
        using (var s = File.OpenRead(path)) using (var h = SHA256.Create())
            return BitConverter.ToString(h.ComputeHash(s)).Replace("-", "").ToLowerInvariant();
    }

    static ModuleDefinition Read(string path, string managedDir = null) {
        if (new FileInfo(path).Length > 64 * 1024 * 1024) throw new InvalidDataException("too_large");
        // Deferred: 건드리는 부분만 읽는다. Immediate는 모든 커스텀 어트리뷰트 인자를 해석하려다
        // UnityEngine enum 때문에 다른 게임 어셈블리를 요구한다(실측). 손대지 않은 어트리뷰트는 원본 blob 그대로 쓴다.
        // 참조는 managedDir(없으면 같은 폴더)에서만 해석. InMemory: 원본 파일 핸들을 잡고 있지 않는다.
        var resolver = new DefaultAssemblyResolver();
        foreach (var d in resolver.GetSearchDirectories()) resolver.RemoveSearchDirectory(d);
        resolver.AddSearchDirectory(managedDir ?? Path.GetDirectoryName(Path.GetFullPath(path)));
        return ModuleDefinition.ReadModule(path, new ReaderParameters { InMemory = true, ReadingMode = ReadingMode.Deferred, AssemblyResolver = resolver });
    }

    // 게임 런타임 어셈블리로 모든 타입·멤버 참조가 해석되는지. 스트리핑으로 빠진 API를 부르면 게임에서 MissingMethodException이 난다.
    static void ReferencesResolve(string dll, string managedDir) {
        if (!File.Exists(Path.Combine(managedDir, "mscorlib.dll")) || !File.Exists(Path.Combine(managedDir, "UnityEngine.CoreModule.dll"))) throw new ArgumentException("managed_dir");
        var m = Read(dll, managedDir);
        foreach (var t in m.GetTypeReferences()) {
            TypeDefinition r = null;
            try { r = t.Resolve(); } catch (AssemblyResolutionException) { }
            if (r == null) throw new Incompatible("unresolved_reference");
        }
        foreach (var x in m.GetMemberReferences()) {
            IMemberDefinition r = null;
            try { r = x.Resolve(); } catch (AssemblyResolutionException) { }
            if (r == null) throw new Incompatible("unresolved_reference");
        }
    }

    const int PatchVersion = 5;
    // 인자 규약 버전. 1 = patch/verify 3인자, 2 = Managed 인자 추가(D-028). 규약이나 PatchVersion을 바꾸면
    // electron/auto-chest.js의 기대값(PATCHER_CLI·PATCH_VERSION)도 같이 바꾼다. 앱은 다르면 설치를 막는다(D-029).
    // 패치 세트 3(D-033 3단계)은 인자 규약을 바꾸지 않았다(inspect 출력에 hiddenFile만 더함). 세트 4(D-046)·5(D-047)도 그대로다.
    const int CliVersion = 2;

    // 앱이 기대하는 패처인지 판정하는 용도. 기기마다 빌드하는 산출물이라 소스보다 오래된 패처가 남을 수 있다.
    static int ToolVersion() {
        return Emit(0, new Dictionary<string, object> { { "ok", true }, { "cli", CliVersion }, { "patchVersion", PatchVersion } });
    }

    // 패치 세트 버전. 0 = 원본, 1 = 상자 자동 오픈만, 2 = + 투명화, 3 = + 차단 멤버 고양이 숨김, 4 = + 투명화 중 획득 팝업 숨김,
    // 5 = + 투명화 루트 후크.
    // 그 밖의 조합은 우리가 만든 적 없는 상태다.
    static int Version(Target t) {
        bool chest = t.Markers.Count == 1 && t.Markers[0] == t.AnchorIndex + 1;
        if (t.Markers.Count != 0 && !chest) throw new Incompatible("marker_unexpected");
        bool transparent = t.TransparentHooked;
        if (transparent && !chest) throw new Incompatible("marker_unexpected");
        bool hidden = t.HiddenHooked;
        if (hidden && !transparent) throw new Incompatible("marker_unexpected");
        bool popup = t.ItemPopupHooked;
        if (popup && !hidden) throw new Incompatible("marker_unexpected");
        bool root = t.RootHooked;
        if (root && !popup) throw new Incompatible("marker_unexpected");
        return root ? 5 : popup ? 4 : hidden ? 3 : transparent ? 2 : chest ? 1 : 0;
    }

    static string State(Target t) { return Version(t) == 0 ? "clean" : "patched"; }

    static string TransparentFlag(string chestFlag) { return Path.Combine(Path.GetDirectoryName(chestFlag), Target.TransparentFlagName); }
    static string HiddenFile(string chestFlag) { return Path.Combine(Path.GetDirectoryName(chestFlag), Target.HiddenFileName); }

    static int Inspect(string dll) {
        var t = Target.Find(Read(dll));
        var version = Version(t);
        var o = new Dictionary<string, object> { { "ok", true }, { "state", State(t) }, { "patchVersion", version }, { "upToDate", version == PatchVersion }, { "sha256", Sha256(dll) },
            { "stateMachine", t.StateMachine.Name }, { "buyReturnsValue", t.Buy.ReturnType.MetadataType != MetadataType.Void } };
        if (version >= 1) o["flag"] = (string)t.MoveNext.Body.Instructions[t.Markers[0]].Operand;
        if (version >= 2) o["transparentFlag"] = (string)t.Smooth.Body.Instructions[t.SmoothMarkers[0]].Operand;
        if (version >= 3) o["hiddenFile"] = t.HiddenFile;
        return Emit(0, o);
    }

    static int Patch(string input, string output, string flag, string managedDir) {
        if (!Path.IsPathRooted(flag) || Path.GetFileName(flag) != Target.FlagName) throw new ArgumentException("flag_path");
        if (string.Equals(Path.GetFullPath(input), Path.GetFullPath(output), StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("in_place");
        var module = Read(input);
        var t = Target.Find(module);
        int version = Version(t);
        if (version == PatchVersion) return Emit(3, new Dictionary<string, object> { { "ok", true }, { "state", "patched" }, { "patchVersion", version }, { "skipped", true } });
        // 이전 세트(v1·v2·v3)로 패치된 입력은 없는 훅만 더한다. 플래그가 다르면 게임이 옮겨진 것이라 원본에서 다시 패치해야 한다.
        if (version >= 1 && !string.Equals((string)t.MoveNext.Body.Instructions[t.Markers[0]].Operand, flag, StringComparison.Ordinal)) throw new Incompatible("upgrade_flag_mismatch");

        // File.Exists는 게임 어셈블리가 이미 참조하는 코어 라이브러리(mscorlib) 기준으로 참조를 만든다.
        var fileType = new TypeReference("System.IO", "File", module, module.TypeSystem.CoreLibrary);
        var exists = new MethodReference("Exists", module.TypeSystem.Boolean, fileType) { HasThis = false };
        exists.Parameters.Add(new ParameterDefinition(module.TypeSystem.String));
        exists = module.ImportReference(exists);

        int inserted = version == 0 ? InsertChest(module, t, flag, exists) : 0;
        if (version < 2) inserted += InsertTransparent(module, t, TransparentFlag(flag), exists);
        if (version < 3) inserted += InsertHidden(module, t, HiddenFile(flag), fileType, exists);
        if (version < 4) inserted += InsertItemPopup(t);
        inserted += InsertRoot(module, t);
        // 삽입으로 거리가 늘어 sbyte 범위(-128~127)를 넘는 기존 짧은 분기는 같은 의미의 긴 분기로 바꾼다.
        // (실측: bgt.s가 삽입 구간을 건너뛰며 범위를 넘어 Cecil이 잘못된 오프셋을 썼다.) 그 외 명령은 그대로.
        // 더한 메서드는 처음부터 긴 분기만 쓴다.
        int widened = t.Patched.Sum(m => WidenShortBranches(m.Body));

        module.Write(output);
        var reread = Read(output);
        var check = Target.Find(reread);
        if (Version(check) != PatchVersion) throw new InvalidDataException("post_patch_state");
        if (!check.Patched.Concat(check.Added).All(m => BranchTargetsResolved(m.Body))) throw new InvalidDataException("post_patch_branch");
        try { ReferencesResolve(output, managedDir); }
        catch { File.Delete(output); throw; }   // 게임에서 깨질 결과물은 남기지 않는다
        return Emit(0, new Dictionary<string, object> { { "ok", true }, { "state", "patched" }, { "patchVersion", PatchVersion }, { "upgraded", version > 0 }, { "sha256", Sha256(output) }, { "inserted", inserted }, { "widenedBranches", widened } });
    }

    static int InsertChest(ModuleDefinition module, Target t, string flag, MethodReference exists) {
        var body = t.MoveNext.Body;
        var il = body.GetILProcessor();
        var anchor = body.Instructions[t.AnchorIndex];
        var after = anchor.Next;   // 원래 다음 명령. 기존 분기가 이곳을 가리키면 삽입 블록을 건너뛴다(앵커 직후 흐름에만 적용).
        var seq = new List<Instruction> {
            il.Create(OpCodes.Ldstr, flag),
            il.Create(OpCodes.Call, exists),
            il.Create(OpCodes.Brfalse_S, after),
            il.Create(OpCodes.Ldarg_0),
            il.Create(OpCodes.Ldfld, module.ImportReference(t.This)),
            il.Create(OpCodes.Ldfld, module.ImportReference(t.ShopItemField)),
            il.Create(OpCodes.Callvirt, module.ImportReference(t.Buy)),
        };
        if (t.Buy.ReturnType.MetadataType != MetadataType.Void) seq.Add(il.Create(OpCodes.Pop));
        InsertAfter(il, anchor, seq);
        if (body.MaxStackSize < 2) body.MaxStackSize = 2;
        return seq.Count;
    }

    static void InsertAfter(ILProcessor il, Instruction anchor, List<Instruction> seq) {
        var prev = anchor;
        foreach (var i in seq) { il.InsertAfter(prev, i); prev = i; }
    }

    static void InsertBefore(ILProcessor il, Instruction target, List<Instruction> seq) {
        foreach (var i in seq) il.InsertBefore(target, i);
    }

    static MethodReference Accessor(string name, TypeReference type, TypeReference result, TypeReference parameter) {
        var m = new MethodReference(name, result, type) { HasThis = true };
        if (parameter != null) m.Parameters.Add(new ParameterDefinition(parameter));
        return m;
    }

    static int InsertTransparent(ModuleDefinition module, Target t, string flag, MethodReference exists) {
        var groupType = t.HoverAlpha.FieldType;
        var sys = module.TypeSystem;
        var setAlpha = Accessor("set_alpha", groupType, sys.Void, sys.Single);

        // 켜짐 상태는 TranslucentOnHover의 레이어 블록도 읽으므로 어셈블리 내부 공개(internal)다.
        var state = new FieldDefinition(Target.StateFieldName, FieldAttributes.Assembly | FieldAttributes.Static, sys.Boolean);
        var nextPoll = new FieldDefinition(Target.NextPollFieldName, FieldAttributes.Private | FieldAttributes.Static, sys.Single);
        t.HoverSetting.Fields.Add(state);
        t.HoverSetting.Fields.Add(nextPoll);

        // SetTranslucentSmooth: if (File.Exists(flag)) 목표 알파 = 0; 레이어(클릭 통과)는 뒤따르는 게임 코드가 목표 알파로 정한다.
        var smooth = t.Smooth.Body;
        var il = smooth.GetILProcessor();
        var anchor = smooth.Instructions[t.SmoothAnchor];
        var seqSmooth = new List<Instruction> {
            il.Create(OpCodes.Ldstr, flag),
            il.Create(OpCodes.Call, exists),
            il.Create(OpCodes.Brfalse_S, anchor.Next),
            il.Create(OpCodes.Ldc_R4, 0f),
            il.Create(OpCodes.Stloc_0),
        };
        InsertAfter(il, anchor, seqSmooth);

        // SetLayerRecursively: 클릭 예외여도 CanvasGroup 안이고 (투명화 켜짐 || UI로 복원 중)이면 반환하지 않고 계속 진행한다.
        // if (t.IsChildOf(_alpha.transform) && (CatTalkTransparent || layer == _layerUI)) goto 계속; return;
        // 그룹 안 예외의 하위 트리는 원래 전부 UI 레이어다(씬 실측). 그래서 UI 복원이 원상태다. 그룹 밖 예외(메뉴·채팅)는 그대로다.
        var layer = t.Layer.Body;
        il = layer.GetILProcessor();
        var gate = layer.Instructions[t.LayerAnchor];
        var exitRet = layer.Instructions[t.LayerAnchor + 1];
        var proceed = (Instruction)gate.Operand;
        var seqLayer = new List<Instruction> {
            il.Create(OpCodes.Ldarg_1),
            il.Create(OpCodes.Ldarg_0),
            il.Create(OpCodes.Ldfld, t.HoverAlpha),
            il.Create(OpCodes.Callvirt, t.GetTransform),
            il.Create(OpCodes.Callvirt, t.IsChildOf),
            il.Create(OpCodes.Brfalse_S, exitRet),
            il.Create(OpCodes.Ldsfld, state),
            il.Create(OpCodes.Brtrue_S, proceed),
            il.Create(OpCodes.Ldarg_2),
            il.Create(OpCodes.Ldarg_0),
            il.Create(OpCodes.Ldfld, t.LayerUI),
            il.Create(OpCodes.Beq_S, proceed),
        };
        InsertBefore(il, exitRet, seqLayer);

        // Start 끝: if (File.Exists(flag)) { _alpha.alpha = 0; SetTranslucentSmooth(true); }
        var start = t.HoverStart.Body;
        il = start.GetILProcessor();
        var ret = start.Instructions[start.Instructions.Count - 1];
        var seqStart = new List<Instruction> {
            il.Create(OpCodes.Ldstr, flag),
            il.Create(OpCodes.Call, exists),
            il.Create(OpCodes.Brfalse_S, ret),
            il.Create(OpCodes.Ldarg_0),
            il.Create(OpCodes.Ldfld, t.HoverAlpha),
            il.Create(OpCodes.Ldc_R4, 0f),
            il.Create(OpCodes.Callvirt, setAlpha),
            il.Create(OpCodes.Ldarg_0),
            il.Create(OpCodes.Ldc_I4_1),
            il.Create(OpCodes.Call, t.Smooth),
        };
        InsertBefore(il, ret, seqStart);

        // Update 처음: 0.5초마다 플래그를 보고, 바뀌었으면 OnSetTranslucent?.Invoke(켜짐).
        var update = t.SettingUpdate.Body;
        il = update.GetILProcessor();
        var first = update.Instructions[0];
        var invoke = il.Create(OpCodes.Ldsfld, state);
        var seqUpdate = new List<Instruction> {
            il.Create(OpCodes.Call, t.UnscaledTime),
            il.Create(OpCodes.Ldsfld, nextPoll),
            il.Create(OpCodes.Blt_S, first),
            il.Create(OpCodes.Call, t.UnscaledTime),
            il.Create(OpCodes.Ldc_R4, Target.PollSeconds),
            il.Create(OpCodes.Add),
            il.Create(OpCodes.Stsfld, nextPoll),
            il.Create(OpCodes.Ldstr, flag),
            il.Create(OpCodes.Call, exists),
            il.Create(OpCodes.Ldsfld, state),
            il.Create(OpCodes.Beq_S, first),
            il.Create(OpCodes.Ldsfld, state),
            il.Create(OpCodes.Ldc_I4_0),
            il.Create(OpCodes.Ceq),
            il.Create(OpCodes.Stsfld, state),
            il.Create(OpCodes.Ldsfld, t.OnSetTranslucent),
            il.Create(OpCodes.Dup),
            il.Create(OpCodes.Brtrue_S, invoke),
            il.Create(OpCodes.Pop),
            il.Create(OpCodes.Br_S, first),
            invoke,
            il.Create(OpCodes.Callvirt, t.InvokeBool),
        };
        InsertBefore(il, first, seqUpdate);

        // IsPointerOverUIElement: Ignore Raycast 결과에서 "if (CatTalkTransparent) 다음 결과로" — 투명화 중 고양이는 호버가 아니다.
        var over = t.OverUI.Body;
        var seqOver = BranchAlsoWhenOn(over, t.OverUIAnchor, state);

        // 고양이별 결과 필터 처음: if (CatTalkTransparent && r.gameObject.layer == 2) return false;
        // (판정에서 빠져도 호버 해제 순간 이전 결과 목록이 이 필터로 넘어오므로 여기서도 뺀다)
        var filter = t.HoverFilter.Body;
        il = filter.GetILProcessor();
        var original = filter.Instructions[0];
        var seqFilter = new List<Instruction> {
            il.Create(OpCodes.Ldsfld, state),
            il.Create(OpCodes.Brfalse_S, original),
            il.Create(OpCodes.Ldarga_S, t.HoverFilter.Parameters[0]),
            il.Create(OpCodes.Call, t.ResultGameObject),
            il.Create(OpCodes.Callvirt, t.GetLayer),
            il.Create(OpCodes.Ldc_I4_2),
            il.Create(OpCodes.Bne_Un_S, original),
            il.Create(OpCodes.Ldc_I4_0),
            il.Create(OpCodes.Ret),
        };
        InsertBefore(il, original, seqFilter);

        // 팝업: "if (DisablePopups) 숨김" 다음에 "if (CatTalkTransparent) 숨김" — 이모트 도넛은 닫히고 말풍선 버튼은 감춰진다.
        var donut = t.DonutUpdate.Body;
        var speech = t.SpeechUpdate.Body;
        var seqDonut = BranchAlsoWhenOn(donut, t.DonutAnchor, state);
        var seqSpeech = BranchAlsoWhenOn(speech, t.SpeechAnchor, state);

        foreach (var body in new[] { smooth, layer, start, update, over, filter, donut, speech }) if (body.MaxStackSize < 3) body.MaxStackSize = 3;
        return seqSmooth.Count + seqLayer.Count + seqStart.Count + seqUpdate.Count + seqOver.Count + seqFilter.Count + seqDonut.Count + seqSpeech.Count;
    }

    // 조건 분기(anchor) 바로 뒤에 "if (CatTalkTransparent) 같은 대상으로"를 넣는다. 꺼져 있으면 원래 흐름 그대로다.
    static List<Instruction> BranchAlsoWhenOn(MethodBody body, int anchor, FieldDefinition state) {
        var il = body.GetILProcessor();
        var gate = body.Instructions[anchor];
        var seq = new List<Instruction> {
            il.Create(OpCodes.Ldsfld, state),
            il.Create(OpCodes.Brtrue_S, (Instruction)gate.Operand),
        };
        InsertAfter(il, gate, seq);
        return seq;
    }

    // 차단 멤버 고양이 숨김(D-033 3단계). LobbyMemberInstance에 정적 필드 둘·메서드 넷을 더하고, 게임 메서드 세 곳에 호출을 넣는다.
    // 숨김 setter와 그 호출 대상(Cat Talk 연결 지문 범위)은 고치지 않고 부르기만 한다.
    static int InsertHidden(ModuleDefinition module, Target t, string path, TypeReference fileType, MethodReference exists) {
        var sys = module.TypeSystem;
        // 문자열·파일 API는 스트리핑된 게임 mscorlib에 있다고 확인한 것만 쓴다(Exists·ReadAllText·Contains·Concat·op_Equality).
        // 참조는 게임 어셈블리의 코어 라이브러리 기준이고, 결과는 ReferencesResolve가 게임 런타임으로 다시 해석해 본다.
        var readAll = CoreMethod("ReadAllText", fileType, sys.String, false, sys.String);
        var concat2 = CoreMethod("Concat", sys.String, sys.String, false, sys.String, sys.String);
        var concat3 = CoreMethod("Concat", sys.String, sys.String, false, sys.String, sys.String, sys.String);
        var contains = CoreMethod("Contains", sys.String, sys.Boolean, true, sys.String);
        var equality = CoreMethod("op_Equality", sys.String, sys.Boolean, false, sys.String, sys.String);
        var exception = new TypeReference("System", "Exception", module, sys.CoreLibrary);
        var toArray = new GenericInstanceMethod(t.ToArrayOpen);
        toArray.GenericArguments.Add(t.Member);
        var userType = t.SteamUserDataField.FieldType;

        // 적용한 목록("\n" + 파일 내용. 아직 안 읽었으면 null)과 다음 확인 시각. 우리 메서드만 읽고 쓴다.
        var ids = new FieldDefinition(Target.HiddenIdsFieldName, FieldAttributes.Private | FieldAttributes.Static, sys.String);
        var nextPoll = new FieldDefinition(Target.HiddenPollFieldName, FieldAttributes.Private | FieldAttributes.Static, sys.Single);
        t.Member.Fields.Add(ids);
        t.Member.Fields.Add(nextPoll);

        // static bool CatTalkListed(SteamUserData user, string ids) => ids != null && user != null && ids.Contains("\n" + user.Data.IdStr + "\n");
        // ID 키는 게임 get_IsHidden과 같은 참조(SteamUserData.Data.IdStr, SteamID64 십진)다. 줄 구분자까지 맞춰 다른 ID의 일부와는 맞지 않는다.
        var listed = new MethodDefinition(Target.ListedName, MethodAttributes.Private | MethodAttributes.Static | MethodAttributes.HideBySig, sys.Boolean);
        listed.Parameters.Add(new ParameterDefinition("user", ParameterAttributes.None, userType));
        listed.Parameters.Add(new ParameterDefinition("ids", ParameterAttributes.None, sys.String));
        var userData = new VariableDefinition(t.UserDataType);
        listed.Body.Variables.Add(userData);
        listed.Body.InitLocals = true;
        var il = listed.Body.GetILProcessor();
        var no = il.Create(OpCodes.Ldc_I4_0);
        Append(il, il.Create(OpCodes.Ldarg_1), il.Create(OpCodes.Brfalse, no), il.Create(OpCodes.Ldarg_0), il.Create(OpCodes.Brfalse, no),
            il.Create(OpCodes.Ldarg_1), il.Create(OpCodes.Ldstr, "\n"),
            il.Create(OpCodes.Ldarg_0), il.Create(OpCodes.Callvirt, t.GetData), il.Create(OpCodes.Stloc_0), il.Create(OpCodes.Ldloca_S, userData), il.Create(OpCodes.Call, t.GetIdStr),
            il.Create(OpCodes.Ldstr, "\n"), il.Create(OpCodes.Call, concat3), il.Create(OpCodes.Callvirt, contains), il.Create(OpCodes.Ret),
            no, il.Create(OpCodes.Ret));
        t.Member.Methods.Add(listed);

        // static bool CatTalkHide(bool value, LobbyMemberInstance member) => value || CatTalkListed(member.steamUserData, CatTalkHiddenIds);
        // 인자 순서는 Start의 호출 지점 스택([this, value])에 ldarg.0 하나만 더해 맞춘 것이다.
        var hide = new MethodDefinition(Target.HideName, MethodAttributes.Private | MethodAttributes.Static | MethodAttributes.HideBySig, sys.Boolean);
        hide.Parameters.Add(new ParameterDefinition("value", ParameterAttributes.None, sys.Boolean));
        hide.Parameters.Add(new ParameterDefinition("member", ParameterAttributes.None, t.Member));
        il = hide.Body.GetILProcessor();
        var check = il.Create(OpCodes.Ldarg_1);
        Append(il, il.Create(OpCodes.Ldarg_0), il.Create(OpCodes.Brfalse, check), il.Create(OpCodes.Ldc_I4_1), il.Create(OpCodes.Ret),
            check, il.Create(OpCodes.Ldfld, t.SteamUserDataField), il.Create(OpCodes.Ldsfld, ids), il.Create(OpCodes.Call, listed), il.Create(OpCodes.Ret));
        t.Member.Methods.Add(hide);

        // internal static bool CatTalkVisible(bool visible, SteamUserData user) => visible && !CatTalkListed(user, CatTalkHiddenIds);
        // LobbyMemberVisibility(다른 타입)에서 부르므로 어셈블리 내부 공개다. 그 타입의 private 필드는 호출 지점에서 읽어 넘긴다.
        var visible = new MethodDefinition(Target.VisibleName, MethodAttributes.Assembly | MethodAttributes.Static | MethodAttributes.HideBySig, sys.Boolean);
        visible.Parameters.Add(new ParameterDefinition("visible", ParameterAttributes.None, sys.Boolean));
        visible.Parameters.Add(new ParameterDefinition("user", ParameterAttributes.None, userType));
        il = visible.Body.GetILProcessor();
        var shown = il.Create(OpCodes.Ldc_I4_0);
        Append(il, il.Create(OpCodes.Ldarg_0), il.Create(OpCodes.Brfalse, shown),
            il.Create(OpCodes.Ldarg_1), il.Create(OpCodes.Ldsfld, ids), il.Create(OpCodes.Call, listed), il.Create(OpCodes.Ldc_I4_0), il.Create(OpCodes.Ceq), il.Create(OpCodes.Ret),
            shown, il.Create(OpCodes.Ret));
        t.Member.Methods.Add(visible);

        // internal static void CatTalkPoll(): 0.5초마다 목록 파일을 읽어 전 멤버에 적용한다.
        //   if (Time.unscaledTime < next) return; next = Time.unscaledTime + 0.5f;
        //   try {
        //     string text = ""; if (File.Exists(path)) text = File.ReadAllText(path);
        //     text = "\n" + text; string prev = CatTalkHiddenIds; CatTalkHiddenIds = text;   // 훅 ①②도 이 목록을 본다
        //     if (text == "\n" && prev == "\n") return;   // 지금도 이전에도 목록이 비었으면 멤버를 돌지 않는다
        //     var all = Enumerable.ToArray(MultiplayerLobbyReferences.GameplayInstances.Values);   // 사본: 적용 중 사전이 바뀌어도 안전
        //     for (int i = 0; i < all.Length; i++) {
        //       var m = all[i];
        //       if (CatTalkListed(m.steamUserData, text)) { if (!m.IsHidden) m.IsHidden = true; }   // 새로 든 멤버, 게임 '보이기'로 켜진 멤버
        //       else if (CatTalkListed(m.steamUserData, prev)) m.IsHidden = SettingsManager.Instance.AutoHideCats.Value;   // 해제 = 자동 숨김 기본값(결정 A)
        //     }
        //   } catch (Exception) { }   // 읽기 실패(쓰는 중 등)는 이번 확인만 건너뛴다. 게임 Update는 그대로 진행한다
        var poll = new MethodDefinition(Target.PollName, MethodAttributes.Assembly | MethodAttributes.Static | MethodAttributes.HideBySig, sys.Void);
        var body = poll.Body;
        var member = new VariableDefinition(t.Member);
        foreach (var v in new[] { new VariableDefinition(sys.String), new VariableDefinition(sys.String), new VariableDefinition(new ArrayType(t.Member)),
            new VariableDefinition(sys.Int32), member }) body.Variables.Add(v);
        body.InitLocals = true;
        il = body.GetILProcessor();
        var ret = il.Create(OpCodes.Ret);
        var tryStart = il.Create(OpCodes.Ldstr, "");
        var normalize = il.Create(OpCodes.Ldstr, "\n");
        var work = il.Create(OpCodes.Ldsfld, t.Instances);
        var leave = il.Create(OpCodes.Leave, ret);
        var loop = il.Create(OpCodes.Ldloc_2);
        var unlisted = il.Create(OpCodes.Ldloc_S, member);
        var next = il.Create(OpCodes.Ldloc_3);
        var cond = il.Create(OpCodes.Ldloc_3);
        var handler = il.Create(OpCodes.Pop);
        Append(il,
            il.Create(OpCodes.Call, t.UnscaledTime), il.Create(OpCodes.Ldsfld, nextPoll), il.Create(OpCodes.Blt, ret),
            il.Create(OpCodes.Call, t.UnscaledTime), il.Create(OpCodes.Ldc_R4, Target.PollSeconds), il.Create(OpCodes.Add), il.Create(OpCodes.Stsfld, nextPoll),
            tryStart, il.Create(OpCodes.Stloc_0),
            il.Create(OpCodes.Ldstr, path), il.Create(OpCodes.Call, exists), il.Create(OpCodes.Brfalse, normalize),
            il.Create(OpCodes.Ldstr, path), il.Create(OpCodes.Call, readAll), il.Create(OpCodes.Stloc_0),
            normalize, il.Create(OpCodes.Ldloc_0), il.Create(OpCodes.Call, concat2), il.Create(OpCodes.Stloc_0),
            il.Create(OpCodes.Ldsfld, ids), il.Create(OpCodes.Stloc_1),
            il.Create(OpCodes.Ldloc_0), il.Create(OpCodes.Stsfld, ids),
            il.Create(OpCodes.Ldloc_0), il.Create(OpCodes.Ldstr, "\n"), il.Create(OpCodes.Call, equality), il.Create(OpCodes.Brfalse, work),
            il.Create(OpCodes.Ldloc_1), il.Create(OpCodes.Ldstr, "\n"), il.Create(OpCodes.Call, equality), il.Create(OpCodes.Brtrue, leave),
            work, il.Create(OpCodes.Callvirt, t.Values), il.Create(OpCodes.Call, toArray), il.Create(OpCodes.Stloc_2),
            il.Create(OpCodes.Ldc_I4_0), il.Create(OpCodes.Stloc_3), il.Create(OpCodes.Br, cond),
            loop, il.Create(OpCodes.Ldloc_3), il.Create(OpCodes.Ldelem_Ref), il.Create(OpCodes.Stloc_S, member),
            il.Create(OpCodes.Ldloc_S, member), il.Create(OpCodes.Ldfld, t.SteamUserDataField), il.Create(OpCodes.Ldloc_0), il.Create(OpCodes.Call, listed), il.Create(OpCodes.Brfalse, unlisted),
            il.Create(OpCodes.Ldloc_S, member), il.Create(OpCodes.Callvirt, t.Getter), il.Create(OpCodes.Brtrue, next),
            il.Create(OpCodes.Ldloc_S, member), il.Create(OpCodes.Ldc_I4_1), il.Create(OpCodes.Callvirt, t.Setter), il.Create(OpCodes.Br, next),
            unlisted, il.Create(OpCodes.Ldfld, t.SteamUserDataField), il.Create(OpCodes.Ldloc_1), il.Create(OpCodes.Call, listed), il.Create(OpCodes.Brfalse, next),
            il.Create(OpCodes.Ldloc_S, member), il.Create(OpCodes.Ldsfld, t.SettingsInstance), il.Create(OpCodes.Ldfld, t.AutoHide), il.Create(OpCodes.Callvirt, t.ToggleValue),
            il.Create(OpCodes.Callvirt, t.Setter),
            next, il.Create(OpCodes.Ldc_I4_1), il.Create(OpCodes.Add), il.Create(OpCodes.Stloc_3),
            cond, il.Create(OpCodes.Ldloc_2), il.Create(OpCodes.Ldlen), il.Create(OpCodes.Conv_I4), il.Create(OpCodes.Blt, loop),
            leave,
            handler, il.Create(OpCodes.Leave, ret),
            ret);
        body.ExceptionHandlers.Add(new ExceptionHandler(ExceptionHandlerType.Catch) {
            TryStart = tryStart, TryEnd = handler, HandlerStart = handler, HandlerEnd = ret, CatchType = exception });
        t.Member.Methods.Add(poll);

        // 훅 ① LobbyMemberInstance.Start의 set_IsHidden 호출 직전: [this, value] → [this, CatTalkHide(value, this)]. 입장·재입장 때 처음부터 숨김.
        // 게임은 자동 숨김 경로에서 이 호출로 바로 분기한다(br.s) — 그 분기도 블록 처음으로 옮겨 모든 경로가 블록을 지나게 한다.
        var start = t.MemberStart.Body;
        il = start.GetILProcessor();
        var seqStart = new List<Instruction> { il.Create(OpCodes.Ldarg_0), il.Create(OpCodes.Call, hide) };
        InsertBeforeRetarget(start, start.Instructions[t.StartCall], seqStart);

        // 훅 ② LobbyMemberVisibility.HandleAutoHideUpdated의 SetVisibility 호출 직전: [this, visible] → [this, CatTalkVisible(visible, _steamUserData)].
        // 자동 숨김 토글·참여자 목록 행 생성 때 목록에 있는 멤버는 '숨김'으로 간다(게임 보이기/숨기기 버튼 상태도 그에 맞춰진다).
        var toggleBody = t.VisibilityToggle.Body;
        il = toggleBody.GetILProcessor();
        var seqToggle = new List<Instruction> { il.Create(OpCodes.Ldarg_0), il.Create(OpCodes.Ldfld, t.VisibilityUserField), il.Create(OpCodes.Call, visible) };
        InsertBeforeRetarget(toggleBody, toggleBody.Instructions[t.ToggleCall], seqToggle);

        // 훅 ③ CatSpawnManager.Update 처음: CatTalkPoll()
        var update = t.SpawnUpdate.Body;
        il = update.GetILProcessor();
        var seqUpdate = new List<Instruction> { il.Create(OpCodes.Call, poll) };
        InsertBefore(il, update.Instructions[0], seqUpdate);

        foreach (var b in new[] { start, toggleBody }) if (b.MaxStackSize < 3) b.MaxStackSize = 3;
        listed.Body.MaxStackSize = 4; hide.Body.MaxStackSize = 2; visible.Body.MaxStackSize = 2; body.MaxStackSize = 3;   // Cecil이 쓸 때 다시 계산한다
        return seqStart.Count + seqToggle.Count + seqUpdate.Count
            + listed.Body.Instructions.Count + hide.Body.Instructions.Count + visible.Body.Instructions.Count + body.Instructions.Count;
    }

    // 투명화 중 획득 팝업 숨김(D-046, 세트 4): ShowPopup의 전송 다음(합류점)에 "if (CatTalkTransparent) return;".
    // 전송(SendReceivedItem)은 게이트 앞이라 그대로다. 내 화면에서는 큐에도 넣지 않는다(투명화를 끈 뒤 몰아 뜨지 않음).
    // 전송한 경로도 합류점으로 오므로 그 분기(brfalse)를 게이트 처음으로 옮긴다(훅 ①과 같은 방식). 게이트가 가는 ret은 게임의 "if (!gameObject) return;"이다.
    // 켜짐 상태는 투명화 세트가 더한 필드다(이전 세트 입력이면 이미 있고, 원본 입력이면 위에서 방금 더했다).
    static int InsertItemPopup(Target t) {
        var state = t.HoverSetting.Fields.Single(f => f.Name == Target.StateFieldName);
        var body = t.ShowPopup.Body;
        var il = body.GetILProcessor();
        var join = body.Instructions[t.PopupAt];
        var exit = body.Instructions[t.PopupAt + 4];
        var seq = new List<Instruction> { il.Create(OpCodes.Ldsfld, state), il.Create(OpCodes.Brtrue_S, exit) };
        InsertBeforeRetarget(body, join, seq);
        return seq.Count;
    }

    // 투명화 루트 후크(D-047, 세트 5). 투명화 블록(세트 2)이 이미 있는 본문에 넣는다(원본 입력이면 위에서 방금 넣었다).
    static int InsertRoot(ModuleDefinition module, Target t) {
        var sys = module.TypeSystem;
        var groupType = t.HoverAlpha.FieldType;
        var setAlpha = Accessor("set_alpha", groupType, sys.Void, sys.Single);
        var goType = t.GoSetActive.DeclaringType;
        // GameObject.AddComponent<CanvasGroup>(): 게임은 이 제네릭을 참조하지 않지만 런타임 UnityEngine.CoreModule에 있다(실측). 해석 검증이 다시 본다.
        var addOpen = new MethodReference("AddComponent", sys.Void, goType) { HasThis = true };
        var tParam = new GenericParameter("T", addOpen);
        addOpen.GenericParameters.Add(tParam);
        addOpen.ReturnType = tParam;
        var addGroup = new GenericInstanceMethod(addOpen);
        addGroup.GenericArguments.Add(groupType);
        var getToggle = new GenericInstanceMethod(t.GoGetComponent);
        getToggle.GenericArguments.Add(t.Toggle);

        // 내 고양이의 루트 그룹. 직렬화하지 않는 private 인스턴스 필드(씬 데이터와 무관).
        var root = new FieldDefinition(Target.RootFieldName, FieldAttributes.Private, groupType);
        t.Hover.Fields.Add(root);

        // internal static void EmoteDonut.CatTalkCloseMenu(): 열린 게임 메뉴를 게임 닫기 버튼과 같은 경로로 닫는다.
        //   var d = Instance; if (!d) return; var menu = d._menu; if (!menu || !menu.activeSelf) return;
        //   var toggle = menu.GetComponent<ToggleGameObject>(); if (toggle) toggle.SetActive(false); else menu.SetActive(false);
        var close = new MethodDefinition(Target.CloseMenuName, MethodAttributes.Assembly | MethodAttributes.Static | MethodAttributes.HideBySig, sys.Void);
        close.Body.Variables.Add(new VariableDefinition(goType));
        close.Body.Variables.Add(new VariableDefinition(t.Toggle));
        close.Body.InitLocals = true;
        var il = close.Body.GetILProcessor();
        var ret = il.Create(OpCodes.Ret);
        var plain = il.Create(OpCodes.Ldloc_0);
        Append(il,
            il.Create(OpCodes.Ldsfld, t.DonutInstance), il.Create(OpCodes.Call, t.OpImplicit), il.Create(OpCodes.Brfalse, ret),
            il.Create(OpCodes.Ldsfld, t.DonutInstance), il.Create(OpCodes.Ldfld, t.DonutMenu), il.Create(OpCodes.Stloc_0),
            il.Create(OpCodes.Ldloc_0), il.Create(OpCodes.Call, t.OpImplicit), il.Create(OpCodes.Brfalse, ret),
            il.Create(OpCodes.Ldloc_0), il.Create(OpCodes.Callvirt, t.GoActiveSelf), il.Create(OpCodes.Brfalse, ret),
            il.Create(OpCodes.Ldloc_0), il.Create(OpCodes.Callvirt, getToggle), il.Create(OpCodes.Stloc_1),
            il.Create(OpCodes.Ldloc_1), il.Create(OpCodes.Call, t.OpImplicit), il.Create(OpCodes.Brfalse, plain),
            il.Create(OpCodes.Ldloc_1), il.Create(OpCodes.Ldc_I4_0), il.Create(OpCodes.Callvirt, t.ToggleSetActive), il.Create(OpCodes.Br, ret),
            plain, il.Create(OpCodes.Ldc_I4_0), il.Create(OpCodes.Callvirt, t.GoSetActive),
            ret);
        close.Body.MaxStackSize = 2;
        t.Donut.Methods.Add(close);

        // Start: 투명화 블록 바로 앞 — if (_alpha.gameObject != gameObject) CatTalkRoot = gameObject.AddComponent<CanvasGroup>();
        // 로비 고양이는 _alpha가 루트 자신이라 붙이지 않는다(이미 루트 그룹이다). 뒤따르는 투명화 블록의 SetTranslucentSmooth(true)가 처음 알파를 정한다.
        var start = t.HoverStart.Body;
        il = start.GetILProcessor();
        var block = start.Instructions[start.Instructions.Count - 1 - Target.StartInsert];
        var seqStart = new List<Instruction> {
            il.Create(OpCodes.Ldarg_0), il.Create(OpCodes.Ldfld, t.HoverAlpha), il.Create(OpCodes.Callvirt, t.GetGameObject),
            il.Create(OpCodes.Ldarg_0), il.Create(OpCodes.Call, t.GetGameObject), il.Create(OpCodes.Call, t.OpEquality),
            il.Create(OpCodes.Brtrue_S, block),
            il.Create(OpCodes.Ldarg_0), il.Create(OpCodes.Ldarg_0), il.Create(OpCodes.Call, t.GetGameObject), il.Create(OpCodes.Callvirt, addGroup),
            il.Create(OpCodes.Stfld, root),
        };
        InsertBefore(il, block, seqStart);

        // SetTranslucentSmooth: 투명화 블록 바로 다음(그 블록의 '플래그 없음' 분기도 이리로) —
        //   if (CatTalkRoot) { CatTalkRoot.alpha = (목표 == 0) ? 0 : 1; if (목표 == 0) EmoteDonut.CatTalkCloseMenu(); }
        var smooth = t.Smooth.Body;
        il = smooth.GetILProcessor();
        var next = smooth.Instructions[t.SmoothAnchor + 1 + Target.SmoothInsert];
        var seqSmooth = new List<Instruction> {
            il.Create(OpCodes.Ldarg_0), il.Create(OpCodes.Ldfld, root), il.Create(OpCodes.Call, t.OpImplicit), il.Create(OpCodes.Brfalse_S, next),
            il.Create(OpCodes.Ldarg_0), il.Create(OpCodes.Ldfld, root),
            il.Create(OpCodes.Ldloc_0), il.Create(OpCodes.Ldc_R4, 0f), il.Create(OpCodes.Ceq), il.Create(OpCodes.Ldc_I4_0), il.Create(OpCodes.Ceq), il.Create(OpCodes.Conv_R4),
            il.Create(OpCodes.Callvirt, setAlpha),
            il.Create(OpCodes.Ldloc_0), il.Create(OpCodes.Ldc_R4, 0f), il.Create(OpCodes.Bne_Un_S, next),
            il.Create(OpCodes.Call, close),
        };
        InsertBeforeRetarget(smooth, next, seqSmooth);

        foreach (var b in new[] { start, smooth }) if (b.MaxStackSize < 3) b.MaxStackSize = 3;
        return seqStart.Count + seqSmooth.Count + close.Body.Instructions.Count;
    }

    // target 앞에 seq를 넣고, target으로 가던 분기·switch·예외 처리 경계를 seq 처음으로 옮긴다(모든 경로가 블록을 지나게).
    static void InsertBeforeRetarget(MethodBody body, Instruction target, List<Instruction> seq) {
        var il = body.GetILProcessor();
        foreach (var i in seq) il.InsertBefore(target, i);
        var first = seq[0];
        foreach (var i in body.Instructions) {
            if (seq.Contains(i)) continue;
            if (i.Operand == target) i.Operand = first;
            var many = i.Operand as Instruction[];
            if (many != null) for (int k = 0; k < many.Length; k++) if (many[k] == target) many[k] = first;
        }
        foreach (var h in body.ExceptionHandlers) {
            if (h.TryStart == target) h.TryStart = first;
            if (h.TryEnd == target) h.TryEnd = first;
            if (h.HandlerStart == target) h.HandlerStart = first;
            if (h.HandlerEnd == target) h.HandlerEnd = first;
            if (h.FilterStart == target) h.FilterStart = first;
        }
    }

    static MethodReference CoreMethod(string name, TypeReference declaring, TypeReference result, bool hasThis, params TypeReference[] parameters) {
        var m = new MethodReference(name, result, declaring) { HasThis = hasThis };
        foreach (var p in parameters) m.Parameters.Add(new ParameterDefinition(p));
        return m;
    }

    static void Append(ILProcessor il, params Instruction[] seq) { foreach (var i in seq) il.Append(i); }

    static readonly Dictionary<Code, OpCode> LongForm = new Dictionary<Code, OpCode> {
        { Code.Br_S, OpCodes.Br }, { Code.Brfalse_S, OpCodes.Brfalse }, { Code.Brtrue_S, OpCodes.Brtrue },
        { Code.Beq_S, OpCodes.Beq }, { Code.Bge_S, OpCodes.Bge }, { Code.Bgt_S, OpCodes.Bgt }, { Code.Ble_S, OpCodes.Ble },
        { Code.Blt_S, OpCodes.Blt }, { Code.Bne_Un_S, OpCodes.Bne_Un }, { Code.Bge_Un_S, OpCodes.Bge_Un },
        { Code.Bgt_Un_S, OpCodes.Bgt_Un }, { Code.Ble_Un_S, OpCodes.Ble_Un }, { Code.Blt_Un_S, OpCodes.Blt_Un },
        { Code.Leave_S, OpCodes.Leave },
    };

    static void ComputeOffsets(MethodBody body) {
        int offset = 0;
        foreach (var i in body.Instructions) { i.Offset = offset; offset += i.GetSize(); }
    }

    // 범위를 넘는 짧은 분기를 긴 분기로. 크기가 바뀌면 다른 분기 거리도 바뀌므로 변화가 없을 때까지 반복.
    static int WidenShortBranches(MethodBody body) {
        int widened = 0;
        for (bool changed = true; changed; ) {
            changed = false;
            ComputeOffsets(body);
            foreach (var i in body.Instructions) {
                OpCode longForm;
                var target = i.Operand as Instruction;
                if (target == null || !LongForm.TryGetValue(i.OpCode.Code, out longForm)) continue;
                int delta = target.Offset - (i.Offset + i.GetSize());
                if (delta < sbyte.MinValue || delta > sbyte.MaxValue) { i.OpCode = longForm; widened++; changed = true; }
            }
        }
        ComputeOffsets(body);
        foreach (var i in body.Instructions) {
            var target = i.Operand as Instruction;
            if (target == null || !LongForm.ContainsKey(i.OpCode.Code)) continue;
            int delta = target.Offset - (i.Offset + i.GetSize());
            if (delta < sbyte.MinValue || delta > sbyte.MaxValue) throw new InvalidDataException("short_branch_range");
        }
        return widened;
    }

    // 다시 읽은 본문에서 모든 분기·switch 대상이 실제 명령으로 풀리는지(잘못된 오프셋이면 null로 읽힌다).
    static bool BranchTargetsResolved(MethodBody body) {
        foreach (var i in body.Instructions) {
            var fc = i.OpCode.FlowControl;
            if (fc != FlowControl.Branch && fc != FlowControl.Cond_Branch) continue;
            if (i.OpCode.OperandType == OperandType.InlineSwitch) {
                var targets = i.Operand as Instruction[];
                if (targets == null || targets.Any(x => x == null || !body.Instructions.Contains(x))) return false;
            } else {
                var target = i.Operand as Instruction;
                if (target == null || !body.Instructions.Contains(target)) return false;
            }
        }
        return true;
    }

    // ---- verify: MoveNext 외 전 메서드 논리 IL 동일 + 삽입 시퀀스 정확히 1곳 ----
    static string Op(Instruction i, IList<Instruction> all) {
        var o = i.Operand;
        string s;
        if (o == null) s = "";
        else if (o is Instruction) s = "@" + all.IndexOf((Instruction)o);
        else if (o is Instruction[]) s = string.Join(",", ((Instruction[])o).Select(x => "@" + all.IndexOf(x)));
        else if (o is MemberReference) s = ((MemberReference)o).FullName;
        else if (o is VariableDefinition) s = "v" + ((VariableDefinition)o).Index;
        else if (o is ParameterDefinition) s = "p" + ((ParameterDefinition)o).Index;
        else if (o is float) s = ((float)o).ToString("R", System.Globalization.CultureInfo.InvariantCulture);
        else if (o is double) s = ((double)o).ToString("R", System.Globalization.CultureInfo.InvariantCulture);
        else s = Convert.ToString(o, System.Globalization.CultureInfo.InvariantCulture);
        return i.OpCode.Name + " " + s;
    }

    // normalizeBranches: 패치 대상 메서드만. 짧은/긴 분기(bgt.s/bgt)는 의미가 같으므로 같은 명령으로 본다.
    static List<string> Shape(MethodBody b, int skipFrom, int skipCount, bool normalizeBranches) {
        var all = b.Instructions;
        Func<Instruction, string> name = x => {
            OpCode longForm;
            return normalizeBranches && LongForm.TryGetValue(x.OpCode.Code, out longForm) ? longForm.Name : x.OpCode.Name;
        };
        // 건너뛴 구간을 제외한 인덱스 재매핑(삽입 전 원본과 같은 번호가 되도록)
        Func<Instruction, int> map = x => { int k = all.IndexOf(x); return (skipCount > 0 && k > skipFrom + skipCount - 1) ? k - skipCount : k; };
        var lines = new List<string>();
        for (int k = 0; k < all.Count; k++) {
            if (skipCount > 0 && k >= skipFrom && k < skipFrom + skipCount) continue;
            var i = all[k];
            var o = i.Operand;
            string s;
            if (o is Instruction) s = name(i) + " @" + map((Instruction)o);
            else if (o is Instruction[]) s = name(i) + " " + string.Join(",", ((Instruction[])o).Select(x => "@" + map(x)));
            else if (o == null && (i.OpCode.FlowControl == FlowControl.Branch || i.OpCode.FlowControl == FlowControl.Cond_Branch)) s = name(i) + " @unresolved";
            else s = Op(i, all);
            lines.Add(s);
        }
        foreach (var v in b.Variables) lines.Add("local " + v.Index + " " + v.VariableType.FullName);
        foreach (var h in b.ExceptionHandlers)
            lines.Add("eh " + h.HandlerType + " " + map(h.TryStart) + "-" + (h.TryEnd == null ? -1 : map(h.TryEnd)) + " " + map(h.HandlerStart) + "-" + (h.HandlerEnd == null ? -1 : map(h.HandlerEnd))
                + " " + (h.CatchType == null ? "" : h.CatchType.FullName) + " " + (h.FilterStart == null ? "" : map(h.FilterStart).ToString()));
        lines.Add("initlocals " + b.InitLocals);
        return lines;
    }

    static int Verify(string origPath, string patchedPath, string flag, string managedDir) {
        ReferencesResolve(patchedPath, managedDir);   // 구조가 맞아도 게임 런타임에서 깨지면 의미가 없어 가장 먼저 본다
        var a = Read(origPath); var b = Read(patchedPath);
        var ta = Target.Find(a); var tb = Target.Find(b);
        if (State(ta) != "clean") throw new Incompatible("verify_original_not_clean");
        if (Version(tb) != PatchVersion) throw new Incompatible("verify_not_patched");
        var ma = a.GetTypes().SelectMany(t => t.Methods).ToDictionary(m => m.FullName);
        var mb = b.GetTypes().SelectMany(t => t.Methods).ToDictionary(m => m.FullName);
        // 패치가 더하는 메서드는 숨김 넷(CatTalkListed·CatTalkHide·CatTalkVisible·CatTalkPoll)과 메뉴 닫기 하나(EmoteDonut.CatTalkCloseMenu)뿐이다.
        // 그 밖의 메서드 차이는 거부한다.
        var addedMethods = new HashSet<string>(tb.Added.Select(m => m.FullName));
        if (addedMethods.Count != 5 || !ma.Keys.OrderBy(k => k).SequenceEqual(mb.Keys.Where(k => !addedMethods.Contains(k)).OrderBy(k => k)))
            throw new Incompatible("verify_method_set");
        // 패치가 더하는 필드는 정확히 다섯이다(투명화 둘, 숨김 둘, 루트 하나). 그 밖의 타입·필드 차이는 거부한다.
        Func<FieldDefinition, bool> added = f => f == tb.StateField || f == tb.NextPollField || f == tb.HiddenIdsField || f == tb.HiddenPollField || f == tb.RootField;
        var ta2 = a.GetTypes().Select(t => t.FullName + "|" + string.Join(",", t.Fields.Select(f => f.FullName))).OrderBy(x => x);
        var tb2 = b.GetTypes().Select(t => t.FullName + "|" + string.Join(",", t.Fields.Where(f => !added(f)).Select(f => f.FullName))).OrderBy(x => x);
        if (!ta2.SequenceEqual(tb2)) throw new Incompatible("verify_type_or_field_set");
        // 메서드별 삽입 구간(시작, 길이). 이 구간을 뺀 나머지는 원본과 같아야 한다.
        var sites = new Dictionary<string, int[]> {
            { ta.MoveNext.FullName, new[] { tb.AnchorIndex + 1, tb.InsertLength } },
            { ta.Smooth.FullName, new[] { tb.SmoothAnchor + 1, Target.SmoothInsert + Target.RootSmoothInsert } },   // 투명화 블록 + 루트 블록(이어 붙음)
            { ta.Layer.FullName, new[] { tb.LayerAnchor + 1, Target.LayerInsert } },
            { ta.OverUI.FullName, new[] { tb.OverUIAnchor + 1, Target.OverUIInsert } },
            { ta.HoverFilter.FullName, new[] { 0, Target.FilterInsert } },
            { ta.DonutUpdate.FullName, new[] { tb.DonutAnchor + 1, Target.PopupInsert } },
            { ta.SpeechUpdate.FullName, new[] { tb.SpeechAnchor + 1, Target.PopupInsert } },
            { ta.HoverStart.FullName, new[] { tb.RootStartAt, Target.RootStartInsert + Target.StartInsert } },   // 루트 블록 + 투명화 블록(이어 붙음)
            { ta.SettingUpdate.FullName, new[] { 0, Target.UpdateInsert } },
            // 숨김 setter는 사이트가 아니다: 원본과 전체가 같아야 한다(Cat Talk 연결 지문 범위)
            { ta.MemberStart.FullName, new[] { ta.StartCall, Target.MemberStartInsert } },
            { ta.VisibilityToggle.FullName, new[] { ta.ToggleCall, Target.ToggleInsert } },
            { ta.SpawnUpdate.FullName, new[] { 0, Target.SpawnInsert } },
            { ta.ShowPopup.FullName, new[] { ta.PopupAt, Target.ItemPopupInsert } },
        };
        int compared = 0, diffs = 0;
        string firstDiff = null;
        foreach (var kv in ma) {
            var x = kv.Value; var y = mb[kv.Key];
            if (x.HasBody != y.HasBody) { diffs++; if (firstDiff == null) firstDiff = kv.Key; continue; }
            if (!x.HasBody) continue;
            compared++;
            int[] site;
            bool target = sites.TryGetValue(kv.Key, out site);
            var sx = Shape(x.Body, 0, 0, target);
            var sy = target ? Shape(y.Body, site[0], site[1], true) : Shape(y.Body, 0, 0, false);
            if (!sx.SequenceEqual(sy)) { diffs++; if (firstDiff == null) firstDiff = kv.Key; }
        }
        // 삽입 시퀀스 자체 검사(정확히 1곳, 앵커 직후, 기대 형태)
        var ins = tb.MoveNext.Body.Instructions;
        int p = tb.AnchorIndex + 1;
        bool seqOk = tb.Markers.Count == 1 && tb.Markers[0] == p
            && (string)ins[p].Operand == flag
            && Target.IsFileExists(ins[p + 1])
            && ins[p + 2].OpCode == OpCodes.Brfalse_S && ins[p + 2].Operand == ins[p + tb.InsertLength]
            && ins[p + 3].OpCode == OpCodes.Ldarg_0
            && ins[p + 4].OpCode == OpCodes.Ldfld && ((FieldReference)ins[p + 4].Operand).Name == "<>4__this"
            && ins[p + 5].OpCode == OpCodes.Ldfld && ((FieldReference)ins[p + 5].Operand).Name == "_shopItem"
            && ins[p + 6].OpCode == OpCodes.Callvirt && ((MethodReference)ins[p + 6].Operand).Name == "Buy"
            && (tb.InsertLength == 7 || ins[p + 7].OpCode == OpCodes.Pop);
        bool transparentOk = TransparentSequencesOk(tb, TransparentFlag(flag));
        bool hiddenOk = HiddenSequencesOk(tb, HiddenFile(flag));
        bool popupOk = ItemPopupSequenceOk(tb);
        bool rootOk = RootSequencesOk(tb);
        bool branchesOk = tb.Patched.Concat(tb.Added).All(m => BranchTargetsResolved(m.Body));
        bool ok = diffs == 0 && seqOk && transparentOk && hiddenOk && popupOk && rootOk && branchesOk && tb.MoveNext.Body.MaxStackSize >= Math.Max(ta.MoveNext.Body.MaxStackSize, 2);
        var o = new Dictionary<string, object> { { "ok", ok }, { "patchVersion", Version(tb) }, { "methodsCompared", compared }, { "methodDiffs", diffs }, { "insertSequenceOk", seqOk }, { "transparentSequenceOk", transparentOk }, { "hiddenSequenceOk", hiddenOk }, { "itemPopupSequenceOk", popupOk }, { "rootSequenceOk", rootOk }, { "branchTargetsOk", branchesOk },
            { "maxStack", new[] { ta.MoveNext.Body.MaxStackSize, tb.MoveNext.Body.MaxStackSize } } };
        if (firstDiff != null) o["firstDiff"] = firstDiff;
        return Emit(ok ? 0 : 2, o);
    }

    // 삽입 블록 한 명령을 짧은 글로 적는다. 분기는 블록 시작 기준 상대 위치(블록 끝 = 원래 다음 명령).
    static string Brief(Instruction i, IList<Instruction> all, int start) {
        var o = i.Operand;
        if (o is Instruction) return i.OpCode.Name + " +" + (all.IndexOf((Instruction)o) - start);
        var f = o as FieldReference;
        if (f != null) return i.OpCode.Name + " " + f.DeclaringType.Name + "::" + f.Name;
        var m = o as MethodReference;
        if (m != null) return i.OpCode.Name + " " + m.DeclaringType.Name + "::" + m.Name;
        if (o == null) return i.OpCode.Name;
        return i.OpCode.Name + " " + Convert.ToString(o, System.Globalization.CultureInfo.InvariantCulture);
    }

    static bool Matches(MethodBody body, int start, string[] expected) {
        var all = body.Instructions;
        if (start < 0 || start + expected.Length > all.Count) return false;
        return Enumerable.Range(0, expected.Length).All(k => Brief(all[start + k], all, start) == expected[k]);
    }

    // 삽입 블록이 기대 형태 그대로인지. 패치 코드와 따로 적어 둔 표로 비교한다(마커 위치만으로는 내용이 틀어져도 지나간다).
    static bool TransparentSequencesOk(Target t, string flag) {
        const string alpha = "ldfld TranslucentOnHover::_alpha", exists = "call File::Exists";
        const string on = "TranslucentOnHoverSetting::" + Target.StateFieldName, next = "TranslucentOnHoverSetting::" + Target.NextPollFieldName;
        var smooth = new[] { "ldstr " + flag, exists, "brfalse.s +5", "ldc.r4 0", "stloc.0" };
        var layer = new[] { "ldarg.1", "ldarg.0", alpha, "callvirt Component::get_transform", "callvirt Transform::IsChildOf", "brfalse.s +12",
            "ldsfld " + on, "brtrue.s +13", "ldarg.2", "ldarg.0", "ldfld TranslucentOnHover::_layerUI", "beq.s +13" };
        var start = new[] { "ldstr " + flag, exists, "brfalse.s +10", "ldarg.0", alpha, "ldc.r4 0", "callvirt CanvasGroup::set_alpha",
            "ldarg.0", "ldc.i4.1", "call TranslucentOnHover::SetTranslucentSmooth" };
        var update = new[] { "call Time::get_unscaledTime", "ldsfld " + next, "blt.s +22",
            "call Time::get_unscaledTime", "ldc.r4 0.5", "add", "stsfld " + next,
            "ldstr " + flag, exists, "ldsfld " + on, "beq.s +22",
            "ldsfld " + on, "ldc.i4.0", "ceq", "stsfld " + on,
            "ldsfld TranslucentOnHoverSetting::OnSetTranslucent", "dup", "brtrue.s +20", "pop", "br.s +22",
            "ldsfld " + on, "callvirt Action`1::Invoke" };
        return Matches(t.Smooth.Body, t.SmoothAnchor + 1, smooth)
            && Matches(t.Layer.Body, t.LayerAnchor + 1, layer)
            && t.LayerAnchor + 1 + Target.LayerInsert < t.Layer.Body.Instructions.Count
            && t.Layer.Body.Instructions[t.LayerAnchor + 1 + Target.LayerInsert].OpCode == OpCodes.Ret
            && t.StateField.IsAssembly
            && HoverSequencesOk(t)
            && Matches(t.HoverStart.Body, t.HoverStart.Body.Instructions.Count - 1 - Target.StartInsert, start)
            && Matches(t.SettingUpdate.Body, 0, update);
    }

    static bool HoverSequencesOk(Target t) {
        const string on = "ldsfld TranslucentOnHoverSetting::" + Target.StateFieldName;
        var filter = new[] { on, "brfalse.s +9", "ldarga.s " + t.HoverFilter.Parameters[0].Name, "call RaycastResult::get_gameObject",
            "callvirt GameObject::get_layer", "ldc.i4.2", "bne.un.s +9", "ldc.i4.0", "ret" };
        // 판정 블록은 bne.un과 같은 곳(다음 결과)으로, 팝업 블록은 DisablePopups의 brtrue와 같은 곳(숨김)으로
        return BranchesAlsoWhenOn(t.OverUI.Body, t.OverUIAnchor) && Matches(t.HoverFilter.Body, 0, filter)
            && BranchesAlsoWhenOn(t.DonutUpdate.Body, t.DonutAnchor) && BranchesAlsoWhenOn(t.SpeechUpdate.Body, t.SpeechAnchor);
    }

    static bool BranchesAlsoWhenOn(MethodBody body, int a) {
        var ins = body.Instructions;
        return a + 2 < ins.Count
            && Brief(ins[a + 1], ins, a + 1) == "ldsfld TranslucentOnHoverSetting::" + Target.StateFieldName
            && (ins[a + 2].OpCode == OpCodes.Brtrue_S || ins[a + 2].OpCode == OpCodes.Brtrue) && ins[a + 2].Operand == ins[a].Operand;
    }

    // 숨김 훅·더한 메서드가 기대 형태 그대로인지(D-033 3단계). 패치 코드와 따로 적어 둔 표로, 멤버 참조는 전체 이름까지 비교한다.
    // 숨김 setter는 사이트가 아니라 원본과 전체 대조된다(Verify) — 지문 범위를 건드리지 않았다는 보증이다.
    static bool HiddenSequencesOk(Target t, string path) {
        const string member = Target.MemberTypeName;
        const string user = Target.SteamUserDataTypeName;
        const string ids = "System.String " + member + "::" + Target.HiddenIdsFieldName;
        const string next = "System.Single " + member + "::" + Target.HiddenPollFieldName;
        const string memberUser = user + " " + member + "::steamUserData";
        const string listed = "System.Boolean " + member + "::" + Target.ListedName + "(" + user + ",System.String)";
        const string hide = "System.Boolean " + member + "::" + Target.HideName + "(System.Boolean," + member + ")";
        const string visible = "System.Boolean " + member + "::" + Target.VisibleName + "(System.Boolean," + user + ")";
        const string poll = "System.Void " + member + "::" + Target.PollName + "()";
        const string setHidden = "System.Void " + member + "::set_IsHidden(System.Boolean)";
        const string time = "call System.Single UnityEngine.Time::get_unscaledTime()";
        var start = new[] { "ldarg.0", "call " + hide, "call " + setHidden };
        var toggle = new[] { "ldarg.0", "ldfld " + user + " " + Target.VisibilityTypeName + "::_steamUserData", "call " + visible,
            "call System.Void " + Target.VisibilityTypeName + "::SetVisibility(System.Boolean)" };
        var update = new[] { "call " + poll };
        var listedBody = new[] { "ldarg.1", "brfalse +15", "ldarg.0", "brfalse +15", "ldarg.1", "ldstr \n", "ldarg.0",
            "callvirt Heathen.SteamworksIntegration.UserData " + user + "::get_Data()",
            "stloc.0", "ldloca.s V_0", "call System.String Heathen.SteamworksIntegration.UserData::get_IdStr()", "ldstr \n",
            "call System.String System.String::Concat(System.String,System.String,System.String)",
            "callvirt System.Boolean System.String::Contains(System.String)", "ret", "ldc.i4.0", "ret" };
        var hideBody = new[] { "ldarg.0", "brfalse +4", "ldc.i4.1", "ret", "ldarg.1", "ldfld " + memberUser, "ldsfld " + ids, "call " + listed, "ret" };
        var visibleBody = new[] { "ldarg.0", "brfalse +8", "ldarg.1", "ldsfld " + ids, "call " + listed, "ldc.i4.0", "ceq", "ret", "ldc.i4.0", "ret" };
        var pollBody = new[] {
            time, "ldsfld " + next, "blt +76", time, "ldc.r4 0.5", "add", "stsfld " + next,
            "ldstr ", "stloc.0", "ldstr " + path, "call System.Boolean System.IO.File::Exists(System.String)", "brfalse +15",
            "ldstr " + path, "call System.String System.IO.File::ReadAllText(System.String)", "stloc.0",
            "ldstr \n", "ldloc.0", "call System.String System.String::Concat(System.String,System.String)", "stloc.0",
            "ldsfld " + ids, "stloc.1", "ldloc.0", "stsfld " + ids,
            "ldloc.0", "ldstr \n", "call System.Boolean System.String::op_Equality(System.String,System.String)", "brfalse +31",
            "ldloc.1", "ldstr \n", "call System.Boolean System.String::op_Equality(System.String,System.String)", "brtrue +73",
            "ldsfld " + Target.InstancesTypeName + " BongoCat.Multiplayer.MultiplayerLobbyReferences::GameplayInstances",
            "callvirt System.Collections.Generic.Dictionary`2/ValueCollection<!0,!1> " + Target.InstancesTypeName + "::get_Values()",
            "call !!0[] System.Linq.Enumerable::ToArray<" + member + ">(System.Collections.Generic.IEnumerable`1<!!0>)", "stloc.2",
            "ldc.i4.0", "stloc.3", "br +68",
            "ldloc.2", "ldloc.3", "ldelem.ref", "stloc.s V_4",
            "ldloc.s V_4", "ldfld " + memberUser, "ldloc.0", "call " + listed, "brfalse +54",
            "ldloc.s V_4", "callvirt System.Boolean " + member + "::get_IsHidden()", "brtrue +64",
            "ldloc.s V_4", "ldc.i4.1", "callvirt " + setHidden, "br +64",
            "ldloc.s V_4", "ldfld " + memberUser, "ldloc.1", "call " + listed, "brfalse +64",
            "ldloc.s V_4", "ldsfld BongoCat.SettingsManager BongoCat.SettingsManager::Instance",
            "ldfld BongoCat.PlayerPrefsToggle BongoCat.SettingsManager::AutoHideCats",
            "callvirt System.Boolean BongoCat.PlayerPrefsToggle::get_Value()", "callvirt " + setHidden,
            "ldloc.3", "ldc.i4.1", "add", "stloc.3",
            "ldloc.3", "ldloc.2", "ldlen", "conv.i4", "blt +38",
            "leave +76", "pop", "leave +76", "ret" };
        var pollLocals = new[] { "System.String", "System.String", member + "[]", "System.Int32", member };
        var startIns = t.MemberStart.Body.Instructions;
        var toggleIns = t.VisibilityToggle.Body.Instructions;
        return Exactly(t.MemberStart.Body, t.StartCall - 2, start) && !Targeted(t.MemberStart.Body, startIns[t.StartCall])
            && Exactly(t.VisibilityToggle.Body, t.ToggleCall - 3, toggle) && !Targeted(t.VisibilityToggle.Body, toggleIns[t.ToggleCall])
            && Exactly(t.SpawnUpdate.Body, 0, update)
            && Whole(t.ListedMethod, listedBody, "System.Boolean", new[] { user, "System.String" }, new[] { "Heathen.SteamworksIntegration.UserData" }, MethodAttributes.Private)
            && Whole(t.HideMethod, hideBody, "System.Boolean", new[] { "System.Boolean", member }, new string[0], MethodAttributes.Private)
            && Whole(t.VisibleMethod, visibleBody, "System.Boolean", new[] { "System.Boolean", user }, new string[0], MethodAttributes.Assembly)
            && Whole(t.PollMethod, pollBody, "System.Void", new string[0], pollLocals, MethodAttributes.Assembly)
            && t.ListedMethod.Body.ExceptionHandlers.Count == 0 && t.HideMethod.Body.ExceptionHandlers.Count == 0
            && t.VisibleMethod.Body.ExceptionHandlers.Count == 0 && PollHandlerOk(t.PollMethod.Body)
            && t.HiddenIdsField.IsPrivate && t.HiddenPollField.IsPrivate;
    }

    // 획득 팝업 게이트(D-046): 전송 다음이 "ldsfld CatTalkTransparent; brtrue <게임의 '오브젝트 없음' ret>"이고,
    // 전송 분기를 포함해 원래 합류점으로 바로 가는 분기가 없다(모든 경로가 게이트를 지난다). 전송 호출 자체는 원본 대조(Verify)로 그대로임을 본다.
    static bool ItemPopupSequenceOk(Target t) {
        var body = t.ShowPopup.Body;
        var ins = body.Instructions;
        int at = t.PopupAt;
        return at + Target.ItemPopupInsert + 4 < ins.Count
            && ins[at].OpCode == OpCodes.Ldsfld && IsState(ins[at].Operand as FieldReference, t)
            && (ins[at + 1].OpCode == OpCodes.Brtrue_S || ins[at + 1].OpCode == OpCodes.Brtrue)
            && ins[at + 1].Operand == ins[at + Target.ItemPopupInsert + 4] && ins[at + Target.ItemPopupInsert + 4].OpCode == OpCodes.Ret
            && !Targeted(body, ins[at + Target.ItemPopupInsert]);
    }

    // 투명화 루트 후크(D-047): 블록 둘과 더한 메서드가 기대 형태 그대로인지(패치 코드와 따로 적어 둔 표, 멤버는 전체 이름까지).
    // Smooth 블록 다음 명령(원래 다음)으로 가는 분기는 블록 안의 것뿐이어야 한다(투명화 블록의 '플래그 없음' 분기도 루트 블록을 지난다).
    static bool RootSequencesOk(Target t) {
        const string root = "UnityEngine.CanvasGroup TranslucentOnHover::" + Target.RootFieldName;
        const string go = "UnityEngine.GameObject UnityEngine.Component::get_gameObject()";
        const string isSet = "call System.Boolean UnityEngine.Object::op_Implicit(UnityEngine.Object)";
        var start = new[] { "ldarg.0", "ldfld UnityEngine.CanvasGroup TranslucentOnHover::_alpha", "callvirt " + go,
            "ldarg.0", "call " + go, "call System.Boolean UnityEngine.Object::op_Equality(UnityEngine.Object,UnityEngine.Object)", "brtrue.s +12",
            "ldarg.0", "ldarg.0", "call " + go, "callvirt !!0 UnityEngine.GameObject::AddComponent<UnityEngine.CanvasGroup>()", "stfld " + root };
        var smooth = new[] { "ldarg.0", "ldfld " + root, isSet, "brfalse.s +17",
            "ldarg.0", "ldfld " + root, "ldloc.0", "ldc.r4 0", "ceq", "ldc.i4.0", "ceq", "conv.r4",
            "callvirt System.Void UnityEngine.CanvasGroup::set_alpha(System.Single)",
            "ldloc.0", "ldc.r4 0", "bne.un.s +17", "call System.Void EmoteDonut::" + Target.CloseMenuName + "()" };
        var close = new[] {
            "ldsfld EmoteDonut EmoteDonut::Instance", isSet, "brfalse +25",
            "ldsfld EmoteDonut EmoteDonut::Instance", "ldfld UnityEngine.GameObject EmoteDonut::_menu", "stloc.0",
            "ldloc.0", isSet, "brfalse +25",
            "ldloc.0", "callvirt System.Boolean UnityEngine.GameObject::get_activeSelf()", "brfalse +25",
            "ldloc.0", "callvirt !!0 UnityEngine.GameObject::GetComponent<ToggleGameObject>()", "stloc.1",
            "ldloc.1", isSet, "brfalse +22",
            "ldloc.1", "ldc.i4.0", "callvirt System.Void ToggleGameObject::SetActive(System.Boolean)", "br +25",
            "ldloc.0", "ldc.i4.0", "callvirt System.Void UnityEngine.GameObject::SetActive(System.Boolean)",
            "ret" };
        var body = t.Smooth.Body.Instructions;
        int at = t.RootSmoothAt;
        if (at + Target.RootSmoothInsert >= body.Count) return false;
        var next = body[at + Target.RootSmoothInsert];
        bool onlyBlockJumps = !Enumerable.Range(0, body.Count).Any(k => (k < at || k >= at + Target.RootSmoothInsert) && body[k].Operand == next);
        return Exactly(t.HoverStart.Body, t.RootStartAt, start)
            && Exactly(t.Smooth.Body, at, smooth) && onlyBlockJumps
            && Whole(t.CloseMenuMethod, close, "System.Void", new string[0], new[] { "UnityEngine.GameObject", "ToggleGameObject" }, MethodAttributes.Assembly)
            && t.CloseMenuMethod.Body.ExceptionHandlers.Count == 0
            && t.RootField.IsPrivate && !t.RootField.IsStatic && t.RootField.FieldType.FullName == "UnityEngine.CanvasGroup";
    }

    static bool IsState(FieldReference f, Target t) {
        return f != null && t.StateField != null && f.Name == t.StateField.Name && f.DeclaringType.FullName == t.StateField.DeclaringType.FullName;
    }

    // 원래 호출로 바로 가는 분기·예외 경계가 남았는지(남았으면 그 경로는 삽입 블록을 건너뛴다)
    static bool Targeted(MethodBody body, Instruction target) {
        return body.Instructions.Any(i => i.Operand == target || (i.Operand is Instruction[] && ((Instruction[])i.Operand).Contains(target)))
            || body.ExceptionHandlers.Any(h => h.TryStart == target || h.TryEnd == target || h.HandlerStart == target || h.HandlerEnd == target || h.FilterStart == target);
    }

    // 블록 한 명령을 적는다. 분기는 블록 시작 기준 상대 위치, 멤버는 전체 이름(시그니처 포함).
    static string Exact(Instruction i, IList<Instruction> all, int start) {
        var o = i.Operand;
        if (o is Instruction) return i.OpCode.Name + " +" + (all.IndexOf((Instruction)o) - start);
        var m = o as MemberReference;
        if (m != null) return i.OpCode.Name + " " + m.FullName;
        if (o == null) return i.OpCode.Name;
        if (o is float) return i.OpCode.Name + " " + ((float)o).ToString("R", System.Globalization.CultureInfo.InvariantCulture);
        return i.OpCode.Name + " " + Convert.ToString(o, System.Globalization.CultureInfo.InvariantCulture);
    }

    static bool Exactly(MethodBody body, int start, string[] expected) {
        var all = body.Instructions;
        if (start < 0 || start + expected.Length > all.Count) return false;
        return Enumerable.Range(0, expected.Length).All(k => Exact(all[start + k], all, start) == expected[k]);
    }

    // 더한 메서드 전체: 정적·접근 수준·시그니처·지역 변수·본문이 표와 같아야 한다.
    static bool Whole(MethodDefinition m, string[] body, string result, string[] parameters, string[] locals, MethodAttributes access) {
        return m.IsStatic && !m.IsVirtual && (m.Attributes & MethodAttributes.MemberAccessMask) == access
            && m.ReturnType.FullName == result
            && m.Parameters.Select(p => p.ParameterType.FullName).SequenceEqual(parameters)
            && m.Body.Variables.Select(v => v.VariableType.FullName).SequenceEqual(locals)
            && m.Body.Instructions.Count == body.Length && Exactly(m.Body, 0, body);
    }

    // 확인 본문(파일 읽기~적용)만 try, 처리기는 예외를 버리고 끝낸다.
    static bool PollHandlerOk(MethodBody b) {
        if (b.ExceptionHandlers.Count != 1) return false;
        var h = b.ExceptionHandlers[0];
        var ins = b.Instructions;
        return h.HandlerType == ExceptionHandlerType.Catch && h.CatchType != null && h.CatchType.FullName == "System.Exception"
            && ins.IndexOf(h.TryStart) == 7 && ins.IndexOf(h.TryEnd) == 74 && ins.IndexOf(h.HandlerStart) == 74 && ins.IndexOf(h.HandlerEnd) == 76;
    }

    // ---- backup/restore: clean일 때만 백업, SHA-256 기록. 복원은 SHA·clean 확인 후 byte-exact 복사 ----
    const string BackupName = "Assembly-CSharp.dll.orig";
    const string ShaName = "Assembly-CSharp.dll.orig.sha256";

    static int Backup(string dll, string dir) {
        var t = Target.Find(Read(dll));
        if (State(t) != "clean") throw new Incompatible("backup_source_not_clean");
        Directory.CreateDirectory(dir);
        var bak = Path.Combine(dir, BackupName); var shaFile = Path.Combine(dir, ShaName);
        var sha = Sha256(dll);
        if (File.Exists(bak) && File.Exists(shaFile) && File.ReadAllText(shaFile).Trim() == sha && Sha256(bak) == sha)
            return Emit(0, new Dictionary<string, object> { { "ok", true }, { "sha256", sha }, { "skipped", true } });
        // 기존 백업이 있으면 보존하고 새 이름으로 비켜 둔다(좋은 백업을 덮지 않는다).
        if (File.Exists(bak)) File.Move(bak, bak + "." + DateTime.UtcNow.ToString("yyyyMMddHHmmss"));
        if (File.Exists(shaFile)) File.Move(shaFile, shaFile + "." + DateTime.UtcNow.ToString("yyyyMMddHHmmss"));
        var tmp = bak + ".tmp";
        File.Copy(dll, tmp, true);
        if (Sha256(tmp) != sha) { File.Delete(tmp); throw new InvalidDataException("backup_copy_mismatch"); }
        File.Move(tmp, bak);
        File.WriteAllText(shaFile, sha + "\n", new UTF8Encoding(false));
        return Emit(0, new Dictionary<string, object> { { "ok", true }, { "sha256", sha } });
    }

    static int Restore(string dir, string target) {
        var bak = Path.Combine(dir, BackupName); var shaFile = Path.Combine(dir, ShaName);
        if (!File.Exists(bak) || !File.Exists(shaFile)) throw new Incompatible("restore_no_backup");
        var expected = File.ReadAllText(shaFile).Trim();
        if (Sha256(bak) != expected) throw new Incompatible("restore_backup_hash_mismatch");
        if (State(Target.Find(Read(bak))) != "clean") throw new Incompatible("restore_backup_not_clean");
        var tmp = target + ".cattalk-restore.tmp";
        File.Copy(bak, tmp, true);
        if (Sha256(tmp) != expected) { File.Delete(tmp); throw new InvalidDataException("restore_copy_mismatch"); }
        File.Copy(tmp, target, true);
        File.Delete(tmp);
        if (Sha256(target) != expected) throw new InvalidDataException("restore_verify_mismatch");
        return Emit(0, new Dictionary<string, object> { { "ok", true }, { "sha256", expected } });
    }
}
