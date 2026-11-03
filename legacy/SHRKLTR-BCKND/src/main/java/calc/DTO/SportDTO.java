package calc.DTO;

/**
 * Created by clementperez on 10/2/16.
 */
public class SportDTO {
    private Long sportId;
    private String name;

    public SportDTO() {
        super();
    }

    public SportDTO(String name){
        this.name = name;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public Long getSportId() {
        return sportId;
    }

    public void setSportId(Long sportId) {
        this.sportId = sportId;
    }
}
