// 패처 구조 검증용 변형 사본 생성기(D-028). test-copy.ps1이 작업 폴더에서만 빌드·실행한다. 게임 어셈블리를 로드·실행하지 않는다.
// 사용: TestMutate <in> <out> <변형>. 변형은 아래 switch 참고. 산출물은 패처가 거부해야 하는 어셈블리다.
// strip-set-alpha만 게임 참조 어셈블리(UnityEngine.UIModule.dll) 사본을 받는다.
using System;
using System.Linq;
using Mono.Cecil;
using Mono.Cecil.Cil;

static class TestMutate {
    static MethodDefinition Method(ModuleDefinition m, string type, string name) {
        return m.GetTypes().Single(t => t.FullName == type).Methods.Single(x => x.Name == name);
    }

    static MethodDefinition Filter(ModuleDefinition m) {
        return m.GetTypes().Single(t => t.FullName == "BongoCat.OnSpecificUIHoverCallback").Methods
            .Single(x => x.Parameters.Count == 1 && x.Parameters[0].ParameterType.FullName == "UnityEngine.EventSystems.RaycastResult");
    }

    // 켜짐 상태 읽기(ldsfld CatTalkTransparent)를 다른 필드로 바꿔 그 자리의 훅만 없는 것처럼 만든다.
    static void StateToOther(ModuleDefinition m, TypeDefinition setting, MethodDefinition method) {
        method.Body.Instructions.Single(i => i.OpCode == OpCodes.Ldsfld && ((FieldReference)i.Operand).Name == "CatTalkTransparent").Operand = setting.Fields.Single(f => f.Name == "CatTalkNextPoll");
    }

    // 마커(ldstr + File.Exists)의 문자열을 바꿔 그 자리의 훅만 없는 것처럼 만든다.
    static void BreakMarker(MethodDefinition method) {
        var ldstr = method.Body.Instructions.Single(i => i.OpCode == OpCodes.Ldstr && ((string)i.Operand).EndsWith("CatTalkTransparent.on"));
        ldstr.Operand = "C:\\Other\\Other.on";
    }

    static int Main(string[] a) {
        var m = ModuleDefinition.ReadModule(a[0], new ReaderParameters { InMemory = true, ReadingMode = ReadingMode.Deferred });
        if (a[2] == "strip-set-alpha") {   // 참조 어셈블리(UnityEngine.UIModule) 사본에서 패치가 쓰는 API 하나를 뺀다(런타임 스트리핑 재현)
            var group = m.GetTypes().Single(t => t.FullName == "UnityEngine.CanvasGroup");
            group.Methods.Remove(group.Methods.Single(x => x.Name == "set_alpha"));
            m.Write(a[1]);
            return 0;
        }
        var hover = m.GetTypes().Single(t => t.FullName == "TranslucentOnHover");
        var setting = m.GetTypes().Single(t => t.FullName == "TranslucentOnHoverSetting");
        switch (a[2]) {
            case "no-hover-type": hover.Name = "Renamed"; break;
            case "no-smooth": Method(m, "TranslucentOnHover", "SetTranslucentSmooth").Name = "Renamed"; break;
            case "no-update": Method(m, "TranslucentOnHoverSetting", "Update").Name = "Renamed"; break;
            case "no-layer": Method(m, "TranslucentOnHover", "SetLayerRecursively").Name = "Renamed"; break;
            case "no-overui": Method(m, "OnUIHoverCallback", "IsPointerOverUIElement").Name = "Renamed"; break;
            case "partial-overui": StateToOther(m, setting, Method(m, "OnUIHoverCallback", "IsPointerOverUIElement")); break;
            case "partial-filter": StateToOther(m, setting, Filter(m)); break;
            case "no-donut": Method(m, "EmoteDonut", "Update").Name = "Renamed"; break;
            case "no-speech": Method(m, "Vfx.CatSpeech", "Update").Name = "Renamed"; break;
            case "partial-donut": StateToOther(m, setting, Method(m, "EmoteDonut", "Update")); break;
            case "partial-speech": StateToOther(m, setting, Method(m, "Vfx.CatSpeech", "Update")); break;
            case "wrong-donut-target": {   // 팝업 블록이 숨김 쪽이 아니라 바로 다음 명령으로 가는 블록(마커는 그대로)
                var body = Method(m, "EmoteDonut", "Update").Body.Instructions;
                var marker = body.Single(i => i.OpCode == OpCodes.Ldsfld && ((FieldReference)i.Operand).Name == "CatTalkTransparent");
                marker.Next.Operand = marker.Next.Next;
                break;
            }
            case "wrong-filter-layer": {   // 필터가 레이어 2 대신 5(UI)를 빼는 블록
                Filter(m).Body.Instructions.Single(i => i.OpCode == OpCodes.Ldc_I4_2).OpCode = OpCodes.Ldc_I4_5;
                break;
            }
            case "no-alpha": hover.Fields.Single(f => f.Name == "_alpha").Name = "_renamed"; break;
            case "extra-anchor": {
                var il = Method(m, "TranslucentOnHover", "SetTranslucentSmooth").Body.GetILProcessor();
                var first = il.Body.Instructions[0];
                il.InsertBefore(first, il.Create(OpCodes.Ldc_R4, 1f));
                il.InsertBefore(first, il.Create(OpCodes.Stloc_0));
                break;
            }
            case "partial-smooth": BreakMarker(Method(m, "TranslucentOnHover", "SetTranslucentSmooth")); break;
            case "partial-start": BreakMarker(Method(m, "TranslucentOnHover", "Start")); break;
            case "partial-update": BreakMarker(Method(m, "TranslucentOnHoverSetting", "Update")); break;
            case "partial-field": setting.Fields.Single(f => f.Name == "CatTalkNextPoll").Name = "Renamed"; break;
            case "partial-layer": {   // 레이어 블록의 켜짐 상태 읽기만 다른 필드로(마커가 사라진 것처럼)
                var body = Method(m, "TranslucentOnHover", "SetLayerRecursively").Body.Instructions;
                body.Single(i => i.OpCode == OpCodes.Ldsfld && ((FieldReference)i.Operand).Name == "CatTalkTransparent").Operand = setting.Fields.Single(f => f.Name == "CatTalkNextPoll");
                break;
            }
            case "wrong-layer": {     // 복원 판정 레이어만 틀어진 블록(UI 대신 Ignore Raycast)
                var body = Method(m, "TranslucentOnHover", "SetLayerRecursively").Body.Instructions;
                body.Single(i => i.OpCode == OpCodes.Ldfld && ((FieldReference)i.Operand).Name == "_layerUI").Operand = hover.Fields.Single(f => f.Name == "_layerIgnoreRaycast");
                break;
            }
            case "call-stripped": {   // 패치 대상 밖 메서드에서 런타임에 없는 API 호출(이번 실패 재현). 해석 검증이 먼저 거부해야 한다
                var il = Method(m, "TranslucentOnHover", "ShowTranslucentTemporarily").Body.GetILProcessor();
                var group = hover.Fields.Single(f => f.Name == "_alpha").FieldType;
                var setBlocks = new MethodReference("set_blocksRaycasts", m.TypeSystem.Void, group) { HasThis = true };
                setBlocks.Parameters.Add(new ParameterDefinition(m.TypeSystem.Boolean));
                var first = il.Body.Instructions[0];
                il.InsertBefore(first, il.Create(OpCodes.Ldarg_0));
                il.InsertBefore(first, il.Create(OpCodes.Ldfld, hover.Fields.Single(f => f.Name == "_alpha")));
                il.InsertBefore(first, il.Create(OpCodes.Ldc_I4_0));
                il.InsertBefore(first, il.Create(OpCodes.Callvirt, m.ImportReference(setBlocks)));
                break;
            }
            case "wrong-alpha": {   // 투명값만 틀어진 블록(마커는 그대로)
                var body = Method(m, "TranslucentOnHover", "SetTranslucentSmooth").Body.Instructions;
                body.Single(i => i.OpCode == OpCodes.Ldc_R4 && (float)i.Operand == 0f).Operand = 0.5f;
                break;
            }
            case "wrong-poll": {    // 폴링 주기만 틀어진 블록
                var body = Method(m, "TranslucentOnHoverSetting", "Update").Body.Instructions;
                body.Single(i => i.OpCode == OpCodes.Ldc_R4).Operand = 5f;
                break;
            }
            case "edit-outside-block": {   // 패치 대상 메서드의 삽입 구간 밖 변경
                var body = Method(m, "TranslucentOnHover", "SetTranslucentSmooth").Body.Instructions;
                body.Single(i => i.OpCode == OpCodes.Ldc_R4 && Math.Abs((float)i.Operand - 0.1f) < 0.001f).Operand = 0.2f;
                break;
            }
            case "edit-other-method": {    // 패치와 무관한 메서드 변경
                var il = Method(m, "TranslucentOnHover", "ShowTranslucentTemporarily").Body.GetILProcessor();
                il.InsertBefore(il.Body.Instructions[0], il.Create(OpCodes.Nop));
                break;
            }
            default: Console.Error.WriteLine("unknown mutation"); return 2;
        }
        m.Write(a[1]);
        return 0;
    }
}
