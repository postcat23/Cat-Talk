// 패처 구조 검증용 변형 사본 생성기(D-028). test-copy.ps1이 작업 폴더에서만 빌드·실행한다. 게임 어셈블리를 로드·실행하지 않는다.
// 사용: TestMutate <in> <out> <변형>. 변형은 아래 switch 참고. 산출물은 패처가 거부해야 하는 어셈블리다.
using System;
using System.Linq;
using Mono.Cecil;
using Mono.Cecil.Cil;

static class TestMutate {
    static MethodDefinition Method(ModuleDefinition m, string type, string name) {
        return m.GetTypes().Single(t => t.FullName == type).Methods.Single(x => x.Name == name);
    }

    // 마커(ldstr + File.Exists)의 문자열을 바꿔 그 자리의 훅만 없는 것처럼 만든다.
    static void BreakMarker(MethodDefinition method) {
        var ldstr = method.Body.Instructions.Single(i => i.OpCode == OpCodes.Ldstr && ((string)i.Operand).EndsWith("CatTalkTransparent.on"));
        ldstr.Operand = "C:\\Other\\Other.on";
    }

    static int Main(string[] a) {
        var m = ModuleDefinition.ReadModule(a[0], new ReaderParameters { InMemory = true, ReadingMode = ReadingMode.Deferred });
        var hover = m.GetTypes().Single(t => t.FullName == "TranslucentOnHover");
        var setting = m.GetTypes().Single(t => t.FullName == "TranslucentOnHoverSetting");
        switch (a[2]) {
            case "no-hover-type": hover.Name = "Renamed"; break;
            case "no-smooth": Method(m, "TranslucentOnHover", "SetTranslucentSmooth").Name = "Renamed"; break;
            case "no-update": Method(m, "TranslucentOnHoverSetting", "Update").Name = "Renamed"; break;
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
