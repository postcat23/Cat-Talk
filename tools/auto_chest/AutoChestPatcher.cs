// Cat-Talk 게임 패처. 게임 어셈블리(Assembly-CSharp.dll)를 Mono.Cecil로 읽어 두 훅을 함께 넣는다.
// 게임 어셈블리를 로드·실행하지 않는다. 패치 세트 버전: 1 = 상자 자동 오픈만, 2 = 상자 자동 오픈 + 투명화.
// 상자 자동 오픈(D-019): Shop.TimerUpdate 상태머신 MoveNext의 "ChestIsReady = true; OnChestReady();" 직후에
//   "if (File.Exists(<플래그>)) this._shopItem.Buy();"를 삽입한다.
// 투명화(D-028): 고양이마다 하나인 TranslucentOnHover의 알파 경로에 플래그를 건다. 삽입은 여섯 곳이다.
//   SetTranslucentSmooth: 플래그가 있으면 목표 알파 0(타이머·호버 복귀도 이 경로라 함께 막힌다).
//     클릭 통과는 게임 경로 그대로다: 목표 알파가 1이 아니면 게임이 Ignore Raycast 레이어로 바꾸고, 창 판정이 이 레이어를 뺀다.
//   SetLayerRecursively: 투명화 중에는 CanvasGroup 안의 클릭 예외(상점·인벤토리 등)도 레이어를 바꾸고, UI로 복원할 때 함께 되돌린다.
//   Start: 플래그가 있으면 새 고양이를 번쩍임 없이 곧바로 투명하게 한다.
//   TranslucentOnHoverSetting.Update: 0.5초마다 플래그 변화를 보고 OnSetTranslucent로 전체에 알린다.
//   호버 두 곳: 게임 호버 판정은 Ignore Raycast도 호버로 쳐서, 투명한 고양이 위에서 이모트 도넛·말풍선이 열린다.
//     OnUIHoverCallback.IsPointerOverUIElement와 OnSpecificUIHoverCallback의 결과 필터에서 투명화 중에는 레이어 2를 뺀다.
// 게임 런타임 어셈블리는 스트리핑돼 공개 Unity API도 없을 수 있다(실측: CanvasGroup.set_blocksRaycasts 없음).
// 그래서 patch·verify는 결과의 모든 참조를 게임 Managed 폴더에서 해석해 보고, 하나라도 안 되면 거부한다.
// 명령: inspect <dll> | patch <in> <out> <flag> <managedDir> | verify <orig> <patched> <flag> <managedDir>
//       backup <dll> <backupDir> | restore <backupDir> <target>
// <flag>는 상자 자동 오픈 플래그다. 투명화 플래그는 같은 폴더의 CatTalkTransparent.on으로 정해지고, 두 플래그는 독립이다.
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

    internal const string FlagName = "CatTalkAutoChest.on";
    internal const string TransparentFlagName = "CatTalkTransparent.on";
    internal const string StateFieldName = "CatTalkTransparent";
    internal const string NextPollFieldName = "CatTalkNextPoll";
    internal const float PollSeconds = 0.5f;
    internal const int SmoothInsert = 5, LayerInsert = 12, StartInsert = 10, UpdateInsert = 22;   // 삽입 명령 수
    internal const int SmoothMarkerAt = 0, UpdateMarkerAt = 7;                  // 삽입 블록 안의 ldstr 위치
    internal const int LayerMarkerAt = 6;                                       // 레이어 블록 안의 ldsfld CatTalkTransparent 위치
    internal const int OverUIInsert = 2, FilterInsert = 9;                      // 호버 블록(마커 = 첫 명령 ldsfld CatTalkTransparent)
    internal const int IgnoreRaycastLayer = 2;                                  // Unity 고정 레이어. 게임 클릭 판정도 상수 2를 쓴다

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

    // 투명화 훅이 전부 제자리에 있는지. 전부 없으면 false, 일부만 있으면 호환 안 됨.
    internal bool TransparentHooked {
        get {
            bool any = SmoothMarkers.Count + LayerMarkers.Count + StartMarkers.Count + UpdateMarkers.Count + OverUIMarkers.Count + FilterMarkers.Count > 0
                || StateField != null || NextPollField != null;
            if (!any) return false;
            bool whole = SmoothMarkers.Count == 1 && SmoothMarkers[0] == SmoothAnchor + 1 + SmoothMarkerAt
                && OverUIMarkers.Count == 1 && OverUIMarkers[0] == OverUIAnchor + 1
                && FilterMarkers.Count == 1 && FilterMarkers[0] == 0
                && LayerMarkers.Count == 1 && LayerMarkers[0] == LayerAnchor + 1 + LayerMarkerAt
                && StartMarkers.Count == 1 && StartMarkers[0] == HoverStart.Body.Instructions.Count - 1 - StartInsert
                && UpdateMarkers.Count == 1 && UpdateMarkers[0] == UpdateMarkerAt
                && StateField != null && StateField.IsStatic && StateField.FieldType.MetadataType == MetadataType.Boolean
                && NextPollField != null && NextPollField.IsStatic && NextPollField.FieldType.MetadataType == MetadataType.Single;
            if (!whole) throw new Incompatible("transparent_partial");
            return true;
        }
    }

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
    internal MethodDefinition[] Patched { get { return new[] { MoveNext, Smooth, Layer, HoverStart, SettingUpdate, OverUI, HoverFilter }; } }

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

    const int PatchVersion = 2;

    // 패치 세트 버전. 0 = 원본, 1 = 상자 자동 오픈만, 2 = 두 훅. 그 밖의 조합은 우리가 만든 적 없는 상태다.
    static int Version(Target t) {
        bool chest = t.Markers.Count == 1 && t.Markers[0] == t.AnchorIndex + 1;
        if (t.Markers.Count != 0 && !chest) throw new Incompatible("marker_unexpected");
        bool transparent = t.TransparentHooked;
        if (transparent && !chest) throw new Incompatible("marker_unexpected");
        return transparent ? 2 : chest ? 1 : 0;
    }

    static string State(Target t) { return Version(t) == 0 ? "clean" : "patched"; }

    static string TransparentFlag(string chestFlag) { return Path.Combine(Path.GetDirectoryName(chestFlag), Target.TransparentFlagName); }

    static int Inspect(string dll) {
        var t = Target.Find(Read(dll));
        var version = Version(t);
        var o = new Dictionary<string, object> { { "ok", true }, { "state", State(t) }, { "patchVersion", version }, { "upToDate", version == PatchVersion }, { "sha256", Sha256(dll) },
            { "stateMachine", t.StateMachine.Name }, { "buyReturnsValue", t.Buy.ReturnType.MetadataType != MetadataType.Void } };
        if (version >= 1) o["flag"] = (string)t.MoveNext.Body.Instructions[t.Markers[0]].Operand;
        if (version >= 2) o["transparentFlag"] = (string)t.Smooth.Body.Instructions[t.SmoothMarkers[0]].Operand;
        return Emit(0, o);
    }

    static int Patch(string input, string output, string flag, string managedDir) {
        if (!Path.IsPathRooted(flag) || Path.GetFileName(flag) != Target.FlagName) throw new ArgumentException("flag_path");
        if (string.Equals(Path.GetFullPath(input), Path.GetFullPath(output), StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("in_place");
        var module = Read(input);
        var t = Target.Find(module);
        int version = Version(t);
        if (version == PatchVersion) return Emit(3, new Dictionary<string, object> { { "ok", true }, { "state", "patched" }, { "patchVersion", version }, { "skipped", true } });
        // 자동 오픈만 패치된 입력은 투명화 훅만 더한다. 플래그가 다르면 게임이 옮겨진 것이라 원본에서 다시 패치해야 한다.
        if (version == 1 && !string.Equals((string)t.MoveNext.Body.Instructions[t.Markers[0]].Operand, flag, StringComparison.Ordinal)) throw new Incompatible("upgrade_flag_mismatch");

        // File.Exists는 게임 어셈블리가 이미 참조하는 코어 라이브러리(mscorlib) 기준으로 참조를 만든다.
        var fileType = new TypeReference("System.IO", "File", module, module.TypeSystem.CoreLibrary);
        var exists = new MethodReference("Exists", module.TypeSystem.Boolean, fileType) { HasThis = false };
        exists.Parameters.Add(new ParameterDefinition(module.TypeSystem.String));
        exists = module.ImportReference(exists);

        int inserted = version == 0 ? InsertChest(module, t, flag, exists) : 0;
        inserted += InsertTransparent(module, t, TransparentFlag(flag), exists);
        // 삽입으로 거리가 늘어 sbyte 범위(-128~127)를 넘는 기존 짧은 분기는 같은 의미의 긴 분기로 바꾼다.
        // (실측: bgt.s가 삽입 구간을 건너뛰며 범위를 넘어 Cecil이 잘못된 오프셋을 썼다.) 그 외 명령은 그대로.
        int widened = t.Patched.Sum(m => WidenShortBranches(m.Body));

        module.Write(output);
        var reread = Read(output);
        var check = Target.Find(reread);
        if (Version(check) != PatchVersion) throw new InvalidDataException("post_patch_state");
        if (!check.Patched.All(m => BranchTargetsResolved(m.Body))) throw new InvalidDataException("post_patch_branch");
        try { ReferencesResolve(output, managedDir); }
        catch { File.Delete(output); throw; }   // 게임에서 깨질 결과물은 남기지 않는다
        return Emit(0, new Dictionary<string, object> { { "ok", true }, { "state", "patched" }, { "patchVersion", PatchVersion }, { "upgraded", version == 1 }, { "sha256", Sha256(output) }, { "inserted", inserted }, { "widenedBranches", widened } });
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
        il = over.GetILProcessor();
        var notIgnore = over.Instructions[t.OverUIAnchor];
        var seqOver = new List<Instruction> {
            il.Create(OpCodes.Ldsfld, state),
            il.Create(OpCodes.Brtrue_S, (Instruction)notIgnore.Operand),
        };
        InsertAfter(il, notIgnore, seqOver);

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

        foreach (var body in new[] { smooth, layer, start, update, over, filter }) if (body.MaxStackSize < 3) body.MaxStackSize = 3;
        return seqSmooth.Count + seqLayer.Count + seqStart.Count + seqUpdate.Count + seqOver.Count + seqFilter.Count;
    }

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
        if (!ma.Keys.OrderBy(k => k).SequenceEqual(mb.Keys.OrderBy(k => k))) throw new Incompatible("verify_method_set");
        // 패치가 더하는 필드는 정확히 둘이다. 그 밖의 타입·필드 차이는 거부한다.
        Func<FieldDefinition, bool> added = f => f == tb.StateField || f == tb.NextPollField;
        var ta2 = a.GetTypes().Select(t => t.FullName + "|" + string.Join(",", t.Fields.Select(f => f.FullName))).OrderBy(x => x);
        var tb2 = b.GetTypes().Select(t => t.FullName + "|" + string.Join(",", t.Fields.Where(f => !added(f)).Select(f => f.FullName))).OrderBy(x => x);
        if (!ta2.SequenceEqual(tb2)) throw new Incompatible("verify_type_or_field_set");
        // 메서드별 삽입 구간(시작, 길이). 이 구간을 뺀 나머지는 원본과 같아야 한다.
        var sites = new Dictionary<string, int[]> {
            { ta.MoveNext.FullName, new[] { tb.AnchorIndex + 1, tb.InsertLength } },
            { ta.Smooth.FullName, new[] { tb.SmoothAnchor + 1, Target.SmoothInsert } },
            { ta.Layer.FullName, new[] { tb.LayerAnchor + 1, Target.LayerInsert } },
            { ta.OverUI.FullName, new[] { tb.OverUIAnchor + 1, Target.OverUIInsert } },
            { ta.HoverFilter.FullName, new[] { 0, Target.FilterInsert } },
            { ta.HoverStart.FullName, new[] { tb.HoverStart.Body.Instructions.Count - 1 - Target.StartInsert, Target.StartInsert } },
            { ta.SettingUpdate.FullName, new[] { 0, Target.UpdateInsert } },
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
        bool branchesOk = tb.Patched.All(m => BranchTargetsResolved(m.Body));
        bool ok = diffs == 0 && seqOk && transparentOk && branchesOk && tb.MoveNext.Body.MaxStackSize >= Math.Max(ta.MoveNext.Body.MaxStackSize, 2);
        var o = new Dictionary<string, object> { { "ok", ok }, { "patchVersion", Version(tb) }, { "methodsCompared", compared }, { "methodDiffs", diffs }, { "insertSequenceOk", seqOk }, { "transparentSequenceOk", transparentOk }, { "branchTargetsOk", branchesOk },
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
        var over = t.OverUI.Body.Instructions;
        int a = t.OverUIAnchor;
        // 판정 블록: 켜져 있으면 bne.un과 같은 곳(다음 결과)으로
        bool overOk = a + Target.OverUIInsert < over.Count
            && Brief(over[a + 1], over, a + 1) == on
            && (over[a + 2].OpCode == OpCodes.Brtrue_S || over[a + 2].OpCode == OpCodes.Brtrue) && over[a + 2].Operand == over[a].Operand;
        var filter = new[] { on, "brfalse.s +9", "ldarga.s " + t.HoverFilter.Parameters[0].Name, "call RaycastResult::get_gameObject",
            "callvirt GameObject::get_layer", "ldc.i4.2", "bne.un.s +9", "ldc.i4.0", "ret" };
        return overOk && Matches(t.HoverFilter.Body, 0, filter);
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
