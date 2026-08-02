import java.io.PrintStream;
import java.util.*;
import java.util.regex.*;

enum PinRole {
    CONTROL, INPUT, OUTPUT
}

interface Component {
    String getName();
    char getTypeCode();
    int getId();
    int getPinCount();
    PinRole getPinRole(int pinNumber);
    void receiveSignal(int pinNumber, int value);
    boolean isReady();
    boolean isEvaluated();
    void evaluate();
    boolean isOutputValid();
    Map<Integer, Integer> getOutputSignals();
    List<String> formatOutput();
    void reset();
}

abstract class AbstractComponent implements Component {
    private final String name;
    private final char typeCode;
    private final int id;
    private final int pinCount;
    private final int[] values;
    private boolean evaluated;

    AbstractComponent(String name, char typeCode, int id, int pinCount) {
        this.name = name;
        this.typeCode = typeCode;
        this.id = id;
        this.pinCount = pinCount;
        this.values = new int[pinCount];
        Arrays.fill(values, -1);
        this.evaluated = false;
    }

    public String getName(){ return name; }
    public char getTypeCode(){ return typeCode; }
    public int getId(){ return id; }
    public int getPinCount(){ return pinCount; }
    public boolean isEvaluated(){ return evaluated; }

    protected int  getPinValue(int pin)  { return values[pin]; }
    protected void setPinOutput(int pin, int value) { values[pin] = value; }
    protected boolean isPinSet(int pin)  { return values[pin] != -1; }
    protected int  getPinCountInternal() { return pinCount; }

    public void receiveSignal(int pinNumber, int value) {
        if (pinNumber < 0 || pinNumber >= pinCount) return;
        if (values[pinNumber] == -1) {
            values[pinNumber] = value;
        }
    }

    protected boolean allPinsSet(int start, int count) {
        for (int i = 0; i < count; i++) {
            if (values[start + i] == -1) return false;
        }
        return true;
    }

    public void reset() {
        Arrays.fill(values, -1);
        evaluated = false;
    }

    public void evaluate() {
        if (!evaluated && isReady()) {
            doEvaluate();
            evaluated = true;
        }
    }

    protected abstract void doEvaluate();
    public abstract boolean isReady();
    public abstract boolean isOutputValid();
    public abstract Map<Integer, Integer> getOutputSignals();
    public abstract List<String> formatOutput();
}


class AndGate extends AbstractComponent {
    private final int inputCount;

    AndGate(String name, int id, int inputCount) {
        super(name, 'A', id, inputCount + 1);
        this.inputCount = inputCount;
    }

    public PinRole getPinRole(int pinNumber) {
        if (pinNumber == 0) return PinRole.OUTPUT;
        if (pinNumber >= 1 && pinNumber <= inputCount) return PinRole.INPUT;
        return null;
    }
    public boolean isReady()  { return allPinsSet(1, inputCount); }
    public boolean isOutputValid() { return isEvaluated(); }

    protected void doEvaluate() {
        int result = 1;
        for (int i = 1; i <= inputCount; i++) {
            if (getPinValue(i) == 0) { result = 0; break; }
        }
        setPinOutput(0, result);
    }

    public Map<Integer, Integer> getOutputSignals() {
        Map<Integer, Integer> m = new HashMap<>();
        if (isOutputValid()) m.put(0, getPinValue(0));
        return m;
    }
    public List<String> formatOutput() {
        if (!isEvaluated() || getPinValue(0) == -1) return Collections.emptyList();
        return Collections.singletonList(getName() + "-0:" + getPinValue(0));
    }
}


class OrGate extends AbstractComponent {
    private final int inputCount;

    OrGate(String name, int id, int inputCount) {
        super(name, 'O', id, inputCount + 1);
        this.inputCount = inputCount;
    }

    public PinRole getPinRole(int pinNumber) {
        if (pinNumber == 0) return PinRole.OUTPUT;
        if (pinNumber >= 1 && pinNumber <= inputCount) return PinRole.INPUT;
        return null;
    }
    public boolean isReady()  { return allPinsSet(1, inputCount); }
    public boolean isOutputValid() { return isEvaluated(); }

    protected void doEvaluate() {
        int result = 0;
        for (int i = 1; i <= inputCount; i++) {
            if (getPinValue(i) == 1) { result = 1; break; }
        }
        setPinOutput(0, result);
    }

    public Map<Integer, Integer> getOutputSignals() {
        Map<Integer, Integer> m = new HashMap<>();
        if (isOutputValid()) m.put(0, getPinValue(0));
        return m;
    }
    public List<String> formatOutput() {
        if (!isEvaluated() || getPinValue(0) == -1) return Collections.emptyList();
        return Collections.singletonList(getName() + "-0:" + getPinValue(0));
    }
}


class NotGate extends AbstractComponent {
    NotGate(String name, int id) { super(name, 'N', id, 2); }

    public PinRole getPinRole(int pinNumber) {
        if (pinNumber == 0) return PinRole.OUTPUT;
        if (pinNumber == 1) return PinRole.INPUT;
        return null;
    }
    public boolean isReady()  { return isPinSet(1); }
    public boolean isOutputValid() { return isEvaluated(); }

    protected void doEvaluate() {
        setPinOutput(0, (getPinValue(1) == 0) ? 1 : 0);
    }

    public Map<Integer, Integer> getOutputSignals() {
        Map<Integer, Integer> m = new HashMap<>();
        if (isOutputValid()) m.put(0, getPinValue(0));
        return m;
    }
    public List<String> formatOutput() {
        if (!isEvaluated() || getPinValue(0) == -1) return Collections.emptyList();
        return Collections.singletonList(getName() + "-0:" + getPinValue(0));
    }
}


class XorGate extends AbstractComponent {
    XorGate(String name, int id) { super(name, 'X', id, 3); }

    public PinRole getPinRole(int pinNumber) {
        if (pinNumber == 0) return PinRole.OUTPUT;
        if (pinNumber == 1 || pinNumber == 2) return PinRole.INPUT;
        return null;
    }
    public boolean isReady()  { return isPinSet(1) && isPinSet(2); }
    public boolean isOutputValid() { return isEvaluated(); }

    protected void doEvaluate() {
        setPinOutput(0, (getPinValue(1) != getPinValue(2)) ? 1 : 0);
    }

    public Map<Integer, Integer> getOutputSignals() {
        Map<Integer, Integer> m = new HashMap<>();
        if (isOutputValid()) m.put(0, getPinValue(0));
        return m;
    }
    public List<String> formatOutput() {
        if (!isEvaluated() || getPinValue(0) == -1) return Collections.emptyList();
        return Collections.singletonList(getName() + "-0:" + getPinValue(0));
    }
}


class XnorGate extends AbstractComponent {
    XnorGate(String name, int id) { super(name, 'Y', id, 3); }

    public PinRole getPinRole(int pinNumber) {
        if (pinNumber == 0) return PinRole.OUTPUT;
        if (pinNumber == 1 || pinNumber == 2) return PinRole.INPUT;
        return null;
    }
    public boolean isReady()  { return isPinSet(1) && isPinSet(2); }
    public boolean isOutputValid() { return isEvaluated(); }

    protected void doEvaluate() {
        setPinOutput(0, (getPinValue(1) == getPinValue(2)) ? 1 : 0);
    }

    public Map<Integer, Integer> getOutputSignals() {
        Map<Integer, Integer> m = new HashMap<>();
        if (isOutputValid()) m.put(0, getPinValue(0));
        return m;
    }
    public List<String> formatOutput() {
        if (!isEvaluated() || getPinValue(0) == -1) return Collections.emptyList();
        return Collections.singletonList(getName() + "-0:" + getPinValue(0));
    }
}


class TriStateGate extends AbstractComponent {
    private static final int PIN_CTRL = 0;
    private static final int PIN_IN   = 1;
    private static final int PIN_OUT  = 2;

    TriStateGate(String name, int id) { super(name, 'S', id, 3); }

    public PinRole getPinRole(int pinNumber) {
        if (pinNumber == PIN_CTRL) return PinRole.CONTROL;
        if (pinNumber == PIN_IN)    return PinRole.INPUT;
        if (pinNumber == PIN_OUT)   return PinRole.OUTPUT;
        return null;
    }
    public boolean isReady()  { return isPinSet(PIN_CTRL) && isPinSet(PIN_IN); }
    public boolean isOutputValid() { return isEvaluated() && getPinValue(PIN_CTRL) == 1; }

    protected void doEvaluate() {
        if (getPinValue(PIN_CTRL) == 1) {
            setPinOutput(PIN_OUT, getPinValue(PIN_IN));
        }
    }

    public Map<Integer, Integer> getOutputSignals() {
        Map<Integer, Integer> m = new HashMap<>();
        if (isOutputValid()) m.put(PIN_OUT, getPinValue(PIN_OUT));
        return m;
    }
    public List<String> formatOutput() {
        if (!isEvaluated() || !isOutputValid()) return Collections.emptyList();
        return Collections.singletonList(getName() + "-" + PIN_OUT + ":" + getPinValue(PIN_OUT));
    }
}


class Decoder extends AbstractComponent {
    private final int inputCount;
    private final int outputCount;
    private final int controlStart;
    private final int inputStart;
    private final int outputStart;

    Decoder(String name, int id, int inputCount) {
        super(name, 'M', id, 2 * inputCount + (1 << inputCount));
        this.inputCount = inputCount;
        this.outputCount = 1 << inputCount;
        this.controlStart = 0;
        this.inputStart = inputCount;
        this.outputStart = 2 * inputCount;
    }

    public PinRole getPinRole(int pinNumber) {
        if (pinNumber < inputCount)            return PinRole.CONTROL;
        if (pinNumber < 2 * inputCount)        return PinRole.INPUT;
        if (pinNumber < getPinCountInternal()) return PinRole.OUTPUT;
        return null;
    }
    public boolean isReady() {
        return allPinsSet(controlStart, inputCount)
            && allPinsSet(inputStart, inputCount);
    }
    public boolean isOutputValid() {
        if (!isEvaluated()) return false;
        // S1=1, S2+S3=0
        if (getPinValue(controlStart) != 1) return false;
        for (int i = 1; i < inputCount; i++) {
            if (getPinValue(controlStart + i) != 0) return false;
        }
        return true;
    }

    protected void doEvaluate() {
        int select = 0;
        for (int i = 0; i < inputCount; i++) {
            select |= (getPinValue(inputStart + i) << i);
        }
        for (int i = 0; i < outputCount; i++) {
            setPinOutput(outputStart + i, (i == select) ? 0 : 1);
        }
    }

    public Map<Integer, Integer> getOutputSignals() {
        Map<Integer, Integer> m = new HashMap<>();
        if (!isOutputValid()) return m;
        for (int i = 0; i < outputCount; i++) {
            m.put(outputStart + i, getPinValue(outputStart + i));
        }
        return m;
    }
    public List<String> formatOutput() {
        if (!isEvaluated() || !isOutputValid()) return Collections.emptyList();
        int zeroIdx = -1;
        for (int i = 0; i < outputCount; i++) {
            if (getPinValue(outputStart + i) == 0) { zeroIdx = i; break; }
        }
        return Collections.singletonList(getName() + ":" + zeroIdx);
    }
}


class Multiplexer extends AbstractComponent {
    private final int controlCount;
    private final int dataCount;
    private final int outputPin;

    Multiplexer(String name, int id, int controlCount) {
        super(name, 'Z', id, controlCount + (1 << controlCount) + 1);
        this.controlCount = controlCount;
        this.dataCount = 1 << controlCount;
        this.outputPin = controlCount + dataCount;
    }

    public PinRole getPinRole(int pinNumber) {
        if (pinNumber < controlCount)                  return PinRole.CONTROL;
        if (pinNumber < controlCount + dataCount)      return PinRole.INPUT;
        if (pinNumber == outputPin)                    return PinRole.OUTPUT;
        return null;
    }
    public boolean isReady()  { return allPinsSet(0, controlCount + dataCount); }
    public boolean isOutputValid() { return isEvaluated(); }

    protected void doEvaluate() {
        // pin 0 = low bit, pin 1 = high bit
        int select = 0;
        for (int i = 0; i < controlCount; i++) {
            if (getPinValue(i) == 1) select |= (1 << i);
        }
        setPinOutput(outputPin, getPinValue(controlCount + select));
    }

    public Map<Integer, Integer> getOutputSignals() {
        Map<Integer, Integer> m = new HashMap<>();
        if (isOutputValid()) m.put(outputPin, getPinValue(outputPin));
        return m;
    }
    public List<String> formatOutput() {
        if (!isEvaluated() || getPinValue(outputPin) == -1) return Collections.emptyList();
        return Collections.singletonList(getName() + "-" + outputPin + ":" + getPinValue(outputPin));
    }
}


class Demultiplexer extends AbstractComponent {
    private final int controlCount;
    private final int outputCount;
    private final int dataPin;

    Demultiplexer(String name, int id, int controlCount) {
        super(name, 'F', id, controlCount + 1 + (1 << controlCount));
        this.controlCount = controlCount;
        this.outputCount = 1 << controlCount;
        this.dataPin = controlCount;
    }

    public PinRole getPinRole(int pinNumber) {
        if (pinNumber < controlCount)            return PinRole.CONTROL;
        if (pinNumber == dataPin)                return PinRole.INPUT;
        if (pinNumber < getPinCountInternal())   return PinRole.OUTPUT;
        return null;
    }
    public boolean isReady()  { return allPinsSet(0, controlCount + 1); }
    public boolean isOutputValid() { return isEvaluated(); }

    protected void doEvaluate() {
        // pin 0 = high bit for demux (opposite of mux)
        int select = 0;
        for (int i = 0; i < controlCount; i++) {
            if (getPinValue(i) == 1) select |= (1 << (controlCount - 1 - i));
        }
        int firstOutput = controlCount + 1;
        // 先设置所有输出为未定义(-1)，再设置选中的
        for (int i = 0; i < outputCount; i++) {
            if (i != select) {
                setPinOutput(firstOutput + i, -1);
            }
        }
        setPinOutput(firstOutput + select, getPinValue(dataPin));
    }

    public Map<Integer, Integer> getOutputSignals() {
        Map<Integer, Integer> m = new HashMap<>();
        if (!isOutputValid()) return m;
        int select = 0;
        for (int i = 0; i < controlCount; i++) {
            if (getPinValue(i) == 1) select |= (1 << (controlCount - 1 - i));
        }
        int firstOutput = controlCount + 1;
        m.put(firstOutput + select, getPinValue(firstOutput + select));
        return m;
    }
    public List<String> formatOutput() {
        if (!isEvaluated()) return Collections.emptyList();
        int firstOutput = controlCount + 1;
        StringBuilder sb = new StringBuilder(outputCount);
        for (int i = 0; i < outputCount; i++) {
            int v = getPinValue(firstOutput + i);
            sb.append(v == -1 ? '-' : (char)('0' + v));
        }
        return Collections.singletonList(getName() + ":" + sb.toString());
    }
}


class ComponentFactory {
    private static final Pattern AO_PAT  = Pattern.compile("^(A|O)\\((\\d+)\\)(\\d+)$");
    private static final Pattern NXY_PAT = Pattern.compile("^(N|X|Y)(\\d+)$");
    private static final Pattern S_PAT   = Pattern.compile("^S(\\d+)$");
    private static final Pattern M_PAT   = Pattern.compile("^M\\((\\d+)\\)(\\d+)$");
    private static final Pattern Z_PAT   = Pattern.compile("^Z\\((\\d+)\\)(\\d+)$");
    private static final Pattern F_PAT   = Pattern.compile("^F\\((\\d+)\\)(\\d+)$");

    private ComponentFactory() {}

    static Component create(String name) {
        if (name == null || name.isEmpty()) return null;
        Matcher m;

        m = AO_PAT.matcher(name);
        if (m.matches()) {
            char type = m.group(1).charAt(0);
            int inputCnt = Integer.parseInt(m.group(2));
            int id = Integer.parseInt(m.group(3));
            return type == 'A' ? new AndGate(name, id, inputCnt)
                               : new OrGate(name, id, inputCnt);
        }

        m = NXY_PAT.matcher(name);
        if (m.matches()) {
            char type = m.group(1).charAt(0);
            int id = Integer.parseInt(m.group(2));
            if (type == 'N') return new NotGate(name, id);
            if (type == 'X') return new XorGate(name, id);
            return new XnorGate(name, id);
        }

        m = S_PAT.matcher(name);
        if (m.matches()) return new TriStateGate(name, Integer.parseInt(m.group(1)));

        m = M_PAT.matcher(name);
        if (m.matches()) return new Decoder(name, Integer.parseInt(m.group(2)),
                                            Integer.parseInt(m.group(1)));

        m = Z_PAT.matcher(name);
        if (m.matches()) return new Multiplexer(name, Integer.parseInt(m.group(2)),
                                                Integer.parseInt(m.group(1)));

        m = F_PAT.matcher(name);
        if (m.matches()) return new Demultiplexer(name, Integer.parseInt(m.group(2)),
                                                  Integer.parseInt(m.group(1)));
        return null;
    }
}


class InputSignal {
    private final String name;
    private final int value;
    InputSignal(String name, int value) { this.name = name; this.value = value; }
    String getName()  { return name; }
    int getValue()    { return value; }
}

class Wire {
    private final String source;
    private final List<String> targets = new ArrayList<>();
    Wire(String source) { this.source = source; }
    String getSource()        { return source; }
    List<String> getTargets() { return targets; }
    void addTarget(String t)  { targets.add(t); }
}

class SignalEvent {
    private final String pin;
    private final int value;
    SignalEvent(String pin, int value) { this.pin = pin; this.value = value; }
    String getPin()   { return pin; }
    int getValue()    { return value; }
}


class Circuit {
    private final List<Component> components = new ArrayList<>();
    private final List<Wire> wires = new ArrayList<>();
    private final List<InputSignal> inputs = new ArrayList<>();

    List<Component> getComponents() { return components; }

    Component findComponent(String name) {
        for (Component c : components) {
            if (c.getName().equals(name)) return c;
        }
        return null;
    }

    Wire findWire(String source) {
        for (Wire w : wires) {
            if (w.getSource().equals(source)) return w;
        }
        return null;
    }

    void addInput(String name, int value) {
        inputs.add(new InputSignal(name, value));
    }

    List<InputSignal> getInputs() { return inputs; }

    void addWire(String source, String target) {
        Wire w = findWire(source);
        if (w == null) {
            w = new Wire(source);
            wires.add(w);
        }
        w.addTarget(target);
    }

    void ensureComponent(String pin) {
        if (pin.equals("OUT")) return;
        String name = parseComponentName(pin);
        if (name != null && findComponent(name) == null) {
            Component c = ComponentFactory.create(name);
            if (c != null) components.add(c);
        }
    }

    private static final Pattern PIN_PAT = Pattern.compile("^(.+)-(\\d+)$");

    static String parseComponentName(String pin) {
        Matcher m = PIN_PAT.matcher(pin);
        return m.matches() ? m.group(1) : null;
    }

    static int parsePinNumber(String pin) {
        Matcher m = PIN_PAT.matcher(pin);
        return m.matches() ? Integer.parseInt(m.group(2)) : -1;
    }
}


class Parser {
    private static final Pattern SIG_PAT = Pattern.compile("([A-Za-z]+)-(\\d+)");
    private static final Pattern BRK_PAT = Pattern.compile("\\[(.+?)\\]");
    private static final Pattern TOK_PAT = Pattern.compile("\\S+");

    Circuit parse(Scanner sc) {
        Circuit ckt = new Circuit();
        while (sc.hasNextLine()) {
            String line = sc.nextLine().trim();
            if (line.isEmpty()) continue;
            if (line.equals("end")) break;

            if (line.startsWith("INPUT:")) {
                Matcher m = SIG_PAT.matcher(line);
                while (m.find()) {
                    ckt.addInput(m.group(1), Integer.parseInt(m.group(2)));
                }
            } else {
                Matcher mb = BRK_PAT.matcher(line);
                if (!mb.find()) continue;

                Matcher mt = TOK_PAT.matcher(mb.group(1).trim());
                List<String> parts = new ArrayList<>();
                while (mt.find()) parts.add(mt.group());
                if (parts.size() < 2) continue;

                String src = parts.get(0);
                for (int i = 1; i < parts.size(); i++) {
                    ckt.addWire(src, parts.get(i));
                    ckt.ensureComponent(parts.get(i));
                }
                ckt.ensureComponent(src);
            }
        }
        return ckt;
    }
}


class Simulator {
    List<String> run(Circuit ckt) {
        Deque<SignalEvent> queue = new ArrayDeque<>();

        for (InputSignal is : ckt.getInputs()) {
            queue.addLast(new SignalEvent(is.getName(), is.getValue()));
        }

        while (!queue.isEmpty()) {
            SignalEvent evt = queue.removeFirst();
            Wire w = ckt.findWire(evt.getPin());
            if (w == null) continue;

            for (String target : w.getTargets()) {
                if (target.equals("OUT")) continue;

                String compName = Circuit.parseComponentName(target);
                int pinNum = Circuit.parsePinNumber(target);
                if (compName == null || pinNum < 0) continue;

                Component comp = ckt.findComponent(compName);
                if (comp == null || comp.isEvaluated()) continue;

                comp.receiveSignal(pinNum, evt.getValue());

                if (comp.isReady() && !comp.isEvaluated()) {
                    comp.evaluate();
                    for (Map.Entry<Integer, Integer> e : comp.getOutputSignals().entrySet())
                        queue.addLast(new SignalEvent(
                            comp.getName() + "-" + e.getKey(), e.getValue()));
                }
            }
        }

        // 排序：A O N X Y S M Z F
        String typeOrder = "AONXYSMZF";
        List<Component> sorted = new ArrayList<>(ckt.getComponents());
        sorted.sort((a, b) -> {
            int ta = typeOrder.indexOf(a.getTypeCode());
            int tb = typeOrder.indexOf(b.getTypeCode());
            if (ta != tb) return Integer.compare(ta, tb);
            return Integer.compare(a.getId(), b.getId());
        });

        List<String> result = new ArrayList<>();
        for (Component comp : sorted) {
            result.addAll(comp.formatOutput());
        }
        return result;
    }
}


public class Main {
    public static void main(String[] args) {
        run(new Scanner(System.in), System.out);
    }

    static void run(Scanner sc, PrintStream out) {
        Parser parser = new Parser();
        Circuit ckt = parser.parse(sc);
        Simulator sim = new Simulator();
        List<String> results = sim.run(ckt);
        for (String line : results) {
            out.println(line);
        }
    }
}
