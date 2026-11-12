// 패처 구조 검증용 변형 사본 생성기(D-028, D-033 3단계, D-046, D-047). test-copy.ps1이 작업 폴더에서만 빌드·실행한다. 게임 어셈블리를 로드·실행하지 않는다.
// 사용: TestMutate <in> <out> <변형>. 변형은 아래 switch 참고. 산출물은 패처가 거부해야 하는 어셈블리다.
// strip-set-alpha는 게임 참조 어셈블리(UnityEngine.UIModule.dll) 사본을, strip-readalltext는 mscorlib.dll 사본을 받는다.
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

    const string MemberType = "BongoCat.Multiplayer.LobbyMemberInstance";
    const string VisibilityType = "BongoCat.Multiplayer.LobbyMemberVisibility";

    // 숨김 훅(D-033 3단계)이 더한 메서드
    static MethodDefinition Added(ModuleDefinition m, string name) { return Method(m, MemberType, name); }

    // 호출 직전 삽입 블록(숨김 훅 ①②)을 걷어 낸다. 블록 처음으로 옮겨 둔 분기를 원래 호출로 되돌린 뒤 지운다.
    static void RemoveBlockBefore(MethodDefinition method, string hookName, int length) {
        var body = method.Body;
        var hook = body.Instructions.Single(i => i.Operand is MethodReference && ((MethodReference)i.Operand).Name == hookName);
        var call = hook.Next;
        var first = body.Instructions[body.Instructions.IndexOf(hook) - (length - 1)];
        foreach (var i in body.Instructions) if (i.Operand == first) i.Operand = call;
        var il = body.GetILProcessor();
        for (int k = 0; k < length; k++) il.Remove(body.Instructions[body.Instructions.IndexOf(call) - 1]);
    }

    static int Main(string[] a) {
        var m = ModuleDefinition.ReadModule(a[0], new ReaderParameters { InMemory = true, ReadingMode = ReadingMode.Deferred });
        if (a[2] == "strip-set-alpha") {   // 참조 어셈블리(UnityEngine.UIModule) 사본에서 패치가 쓰는 API 하나를 뺀다(런타임 스트리핑 재현)
            var group = m.GetTypes().Single(t => t.FullName == "UnityEngine.CanvasGroup");
            group.Methods.Remove(group.Methods.Single(x => x.Name == "set_alpha"));
            m.Write(a[1]);
            return 0;
        }
        if (a[2] == "strip-readalltext") {   // mscorlib 사본에서 숨김 훅만 쓰는 File.ReadAllText(string)를 뺀다(게임 원본은 이 API를 부르지 않는다)
            var file = m.GetTypes().Single(t => t.FullName == "System.IO.File");
            file.Methods.Remove(file.Methods.Single(x => x.Name == "ReadAllText" && x.Parameters.Count == 1));
            m.Write(a[1]);
            return 0;
        }
        var hover = m.GetTypes().Single(t => t.FullName == "TranslucentOnHover");
        var setting = m.GetTypes().Single(t => t.FullName == "TranslucentOnHoverSetting");
        var member = m.GetTypes().Single(t => t.FullName == MemberType);
        switch (a[2]) {
            // ---- 원본(clean) 변형: 숨김 대상 구조가 달라 패치를 거부해야 한다 ----
            case "no-member-type": member.Name = "Renamed"; break;
            case "no-setter": Method(m, MemberType, "set_IsHidden").Name = "Renamed"; break;
            case "no-member-start": Method(m, MemberType, "Start").Name = "Renamed"; break;
            case "no-toggle": Method(m, VisibilityType, "HandleAutoHideUpdated").Name = "Renamed"; break;
            case "no-spawn-update": Method(m, "BongoCat.Multiplayer.Spawning.CatSpawnManager", "Update").Name = "Renamed"; break;
            case "no-autohide": m.GetTypes().Single(t => t.FullName == "BongoCat.SettingsManager").Fields.Single(f => f.Name == "AutoHideCats").Name = "Renamed"; break;
            case "getter-shape": {   // 숨김 키를 읽는 getter 모양이 다름(게임 업데이트 가정)
                var il = Method(m, MemberType, "get_IsHidden").Body.GetILProcessor();
                il.InsertBefore(il.Body.Instructions[0], il.Create(OpCodes.Nop));
                break;
            }
            // ---- v3 변형: 숨김 훅 일부만 있으면 모든 명령이 거부해야 한다 ----
            case "partial-hidden-start": RemoveBlockBefore(Method(m, MemberType, "Start"), "CatTalkHide", 2); break;   // 입장 훅만 없음
            case "partial-hidden-toggle": RemoveBlockBefore(Method(m, VisibilityType, "HandleAutoHideUpdated"), "CatTalkVisible", 3); break;   // 토글 훅만 없음
            case "setter-hook": {   // 2026-11-10 시험본처럼 숨김 setter에 우리 호출이 든 상태(Cat Talk 연결 지문을 깬다) — 다시 패치하지 않는다
                var il = Method(m, MemberType, "set_IsHidden").Body.GetILProcessor();
                il.InsertBefore(il.Body.Instructions[0], il.Create(OpCodes.Call, Added(m, "CatTalkPoll")));
                break;
            }
            case "partial-hidden-update": {   // CatSpawnManager.Update 삽입(1개)을 걷어 낸다
                var il = Method(m, "BongoCat.Multiplayer.Spawning.CatSpawnManager", "Update").Body.GetILProcessor();
                il.Remove(il.Body.Instructions[0]);
                break;
            }
            case "partial-hidden-field": member.Fields.Single(f => f.Name == "CatTalkHiddenPoll").Name = "Renamed"; break;
            case "partial-hidden-method": Added(m, "CatTalkListed").Name = "Renamed"; break;
            // ---- v3 변형: 훅은 제자리지만 내용이 틀려 verify만 거부해야 한다 ----
            case "wrong-hidden-path": {   // 목록 파일 경로가 다름(File.Exists 쪽 리터럴)
                Added(m, "CatTalkPoll").Body.Instructions.First(i => i.OpCode == OpCodes.Ldstr && ((string)i.Operand).EndsWith("CatTalkHidden.ids")).Operand = "C:\\Other\\CatTalkHidden.ids";
                break;
            }
            case "wrong-hidden-poll": Added(m, "CatTalkPoll").Body.Instructions.Single(i => i.OpCode == OpCodes.Ldc_R4).Operand = 5f; break;
            case "wrong-hidden-hide": {   // 새로 든 멤버를 숨기지 않고 보이게 한다
                var body = Added(m, "CatTalkPoll").Body.Instructions;
                body.Single(i => i.OpCode == OpCodes.Ldc_I4_1 && i.Next.OpCode == OpCodes.Callvirt && ((MethodReference)i.Next.Operand).Name == "set_IsHidden").OpCode = OpCodes.Ldc_I4_0;
                break;
            }
            case "wrong-hidden-unhide": {   // 해제를 자동 숨김 기본값이 아니라 무조건 보이기로(결정 A 위반)
                var body = Added(m, "CatTalkPoll").Body.Instructions;
                var instance = body.Single(i => i.OpCode == OpCodes.Ldsfld && ((FieldReference)i.Operand).Name == "Instance");
                var toggle = instance.Next; var value = toggle.Next;
                instance.OpCode = OpCodes.Ldc_I4_0; instance.Operand = null;
                toggle.OpCode = OpCodes.Nop; toggle.Operand = null;
                value.OpCode = OpCodes.Nop; value.Operand = null;
                break;
            }
            case "wrong-hidden-delim": Added(m, "CatTalkListed").Body.Instructions.First(i => i.OpCode == OpCodes.Ldstr).Operand = ","; break;
            case "wrong-hidden-force": Added(m, "CatTalkHide").Body.Instructions.Single(i => i.OpCode == OpCodes.Ldc_I4_1).OpCode = OpCodes.Ldc_I4_0; break;
            case "wrong-hidden-visible": {   // 토글 훅이 '목록에 있으면 숨김' 대신 '목록에 있으면 보이기'
                Added(m, "CatTalkVisible").Body.Instructions.Single(i => i.OpCode == OpCodes.Ceq).Previous.OpCode = OpCodes.Ldc_I4_1;
                break;
            }
            case "wrong-start-target": {   // 자동 숨김 경로의 분기가 입장 훅을 건너뛰고 원래 호출로 바로 간다
                var body = Method(m, MemberType, "Start").Body.Instructions;
                var hook = body.Single(i => i.Operand is MethodReference && ((MethodReference)i.Operand).Name == "CatTalkHide");
                var first = hook.Previous;
                body.First(i => i.Operand == first).Operand = hook.Next;
                break;
            }
            case "edit-setter-outside": {   // set_IsHidden의 삽입 구간 밖 변경(SetActive 인자 반전을 없앤다)
                var body = Method(m, MemberType, "set_IsHidden").Body.Instructions;
                body.Last(i => i.OpCode == OpCodes.Ldc_I4_0).OpCode = OpCodes.Ldc_I4_1;
                break;
            }
            // ---- 획득 팝업 게이트(D-046, 세트 4) ----
            case "no-popup": Method(m, "NewItemPopup", "ShowPopup").Name = "Renamed"; break;   // 원본: 대상 메서드 없음 → 거부
            case "popup-shape": {   // 원본: 합류점의 "if (!gameObject) return;"이 없음(게임 업데이트 가정) → 거부
                var body = Method(m, "NewItemPopup", "ShowPopup").Body.Instructions;
                var send = body.Single(i => i.Operand is MethodReference && ((MethodReference)i.Operand).Name == "SendReceivedItem");
                send.Next.Next.Next.Next.Next.OpCode = OpCodes.Nop;   // 합류점 + 4의 ret
                break;
            }
            case "partial-popup": StateToOther(m, setting, Method(m, "NewItemPopup", "ShowPopup")); break;   // v4: 게이트만 없음 → 모두 거부
            case "wrong-popup-target": {   // v4: 게이트가 ret이 아니라 바로 다음 명령으로 간다(마커는 그대로) → verify만 거부
                var body = Method(m, "NewItemPopup", "ShowPopup").Body.Instructions;
                var marker = body.Single(i => i.OpCode == OpCodes.Ldsfld && ((FieldReference)i.Operand).Name == "CatTalkTransparent");
                marker.Next.Operand = marker.Next.Next;
                break;
            }
            case "popup-skip-gate": {   // v4: 전송 분기가 게이트를 건너뛰고 원래 합류점으로 바로 간다 → verify만 거부
                var body = Method(m, "NewItemPopup", "ShowPopup").Body.Instructions;
                var marker = body.Single(i => i.OpCode == OpCodes.Ldsfld && ((FieldReference)i.Operand).Name == "CatTalkTransparent");
                body.Single(i => i.Operand == marker).Operand = marker.Next.Next;
                break;
            }
            // ---- 투명화 루트 후크(D-047, 세트 5) ----
            case "root-smooth-targets": {   // 원본: 게임 목표 알파(켬)가 0 — '목표 0 = 투명화' 판정이 깨지므로 거부
                var body = Method(m, "TranslucentOnHover", "SetTranslucentSmooth").Body.Instructions;
                body.Single(i => i.OpCode == OpCodes.Ldc_R4 && Math.Abs((float)i.Operand - 0.1f) < 0.001f).Operand = 0f;
                break;
            }
            case "no-toggle-setactive": Method(m, "ToggleGameObject", "SetActive").Name = "Renamed"; break;   // 원본: 메뉴 닫기 경로 없음 → 거부
            case "partial-root-field": hover.Fields.Single(f => f.Name == "CatTalkRoot").Name = "Renamed"; break;   // v5: 루트 필드만 없음 → 모두 거부
            case "partial-root-close": Method(m, "EmoteDonut", "CatTalkCloseMenu").Name = "Renamed"; break;        // v5: 메뉴 닫기만 없음 → 모두 거부
            case "wrong-root-alpha": {   // v5: 루트 알파가 반대(투명화 중 1, 평소 0) → verify만 거부
                var body = Method(m, "TranslucentOnHover", "SetTranslucentSmooth").Body.Instructions;
                body.Single(i => i.OpCode == OpCodes.Ldc_I4_0 && i.Previous.OpCode == OpCodes.Ceq && i.Next.OpCode == OpCodes.Ceq).OpCode = OpCodes.Ldc_I4_1;
                break;
            }
            case "wrong-root-target": {   // v5: 루트 그룹을 내 고양이가 아니라 로비 고양이(_alpha가 루트 자신)에 붙임 → verify만 거부
                var body = Method(m, "TranslucentOnHover", "Start").Body.Instructions;
                body.Single(i => i.OpCode == OpCodes.Call && ((MethodReference)i.Operand).Name == "op_Equality").Next.OpCode = OpCodes.Brfalse_S;
                break;
            }
            case "wrong-close-menu": {   // v5: 메뉴를 닫지 않고 연다 → verify만 거부
                var body = Method(m, "EmoteDonut", "CatTalkCloseMenu").Body.Instructions;
                body.Single(i => i.OpCode == OpCodes.Callvirt && ((MethodReference)i.Operand).DeclaringType.Name == "ToggleGameObject").Previous.OpCode = OpCodes.Ldc_I4_1;
                break;
            }
            case "root-skip": {   // v5: 투명화 블록의 '플래그 없음' 분기가 루트 블록을 건너뜀(끌 때 루트 알파가 1로 안 돌아옴) → verify만 거부
                var body = Method(m, "TranslucentOnHover", "SetTranslucentSmooth").Body.Instructions;
                var exists = body.Single(i => i.Operand is MethodReference && ((MethodReference)i.Operand).Name == "Exists");
                var close = body.Single(i => i.Operand is MethodReference && ((MethodReference)i.Operand).Name == "CatTalkCloseMenu");
                exists.Next.Operand = close.Next;
                break;
            }
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
                body.Single(i => i.OpCode == OpCodes.Ldc_R4 && (float)i.Operand == 0f && i.Next.OpCode == OpCodes.Stloc_0).Operand = 0.5f;
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
