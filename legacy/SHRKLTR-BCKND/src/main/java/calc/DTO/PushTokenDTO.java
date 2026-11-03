package calc.DTO;

/**
 *
 * @author Clement
 */
public class PushTokenDTO {
    private String value;

    public PushTokenDTO() {
    }

    public PushTokenDTO(String value) {
        this.value = value;
    }

    public String getValue() {
        return this.value;
    }

    public void setValue(String value) {
        this.value = value;
    }
}
