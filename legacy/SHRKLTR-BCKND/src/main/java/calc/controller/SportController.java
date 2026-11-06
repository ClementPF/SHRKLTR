package calc.controller;

import calc.DTO.SportDTO;
import calc.security.Secured;
import calc.service.SportService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Created by clementperez on 9/22/16.
*/
@RestController
public class SportController {

    @Autowired
    private SportService sportService;

    @RequestMapping(value = "/sports", method = RequestMethod.GET)
    @Secured
    public List<SportDTO> sports() {
        return sportService.findAll();
    }

    @RequestMapping(value = "/sports", method = RequestMethod.POST)
    @Secured
    public SportDTO addSports(@RequestBody SportDTO sport) {
        return sportService.save(sport);
    }
}
